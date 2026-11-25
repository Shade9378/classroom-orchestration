CREATE UNIQUE INDEX "Participant_normalized_name_key" ON "Participant" (lower(btrim(name)));
