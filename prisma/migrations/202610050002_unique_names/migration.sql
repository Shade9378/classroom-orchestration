BEGIN;
DO $$
DECLARE table_name text; duplicate record; candidate text; suffix integer; taken boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Session', 'Activity', 'Playlist'] LOOP
    EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', table_name);
    FOR duplicate IN EXECUTE format(
      'SELECT id, name FROM (SELECT id, name, row_number() OVER (PARTITION BY lower(btrim(name)) ORDER BY "createdAt", id) AS rank FROM %I) names WHERE rank > 1', table_name)
    LOOP
      suffix := 2;
      LOOP
        candidate := left(btrim(duplicate.name), 85) || ' (' || suffix || ')';
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE lower(btrim(name)) = lower(btrim($1)))', table_name) INTO taken USING candidate;
        EXIT WHEN NOT taken;
        suffix := suffix + 1;
      END LOOP;
      EXECUTE format('UPDATE %I SET name = $1 WHERE id = $2', table_name) USING candidate, duplicate.id;
    END LOOP;
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (lower(btrim(name)))', table_name || '_normalized_name_key', table_name);
  END LOOP;
END $$;
COMMIT;
