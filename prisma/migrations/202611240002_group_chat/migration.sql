CREATE TABLE "GroupChatMessage" (
  "id" UUID NOT NULL PRIMARY KEY,
  "groupId" UUID NOT NULL REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "senderId" TEXT NOT NULL,
  "senderName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'message',
  "context" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX "GroupChatMessage_groupId_createdAt_idx" ON "GroupChatMessage"("groupId", "createdAt");
CREATE UNIQUE INDEX "GroupChatMessage_pending_help_key" ON "GroupChatMessage"("groupId") WHERE "kind" = 'help' AND "resolvedAt" IS NULL;
INSERT INTO "GroupChatMessage" ("id", "groupId", "senderId", "senderName", "text", "kind", "context", "createdAt")
SELECT (m->>'id')::uuid, a."groupId", 'teacher', 'Teacher', m->>'message', 'review',
  activity."name" || ' · ' || CASE WHEN m->>'decision' = 'complete' THEN 'Marked complete' ELSE 'Returned for changes' END,
  (m->>'createdAt')::timestamp
FROM "GroupActivityProgress" p
JOIN "GroupAssignment" a ON a.id = p."assignmentId"
JOIN "Activity" activity ON activity.id = p."activityId"
CROSS JOIN LATERAL jsonb_array_elements(p."reviewMessages") m;
ALTER TABLE "GroupActivityProgress" DROP COLUMN "reviewMessages";
