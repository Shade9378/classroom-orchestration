CREATE TABLE "GroupEditor" (
  "groupId" UUID NOT NULL PRIMARY KEY REFERENCES "Group"("id") ON DELETE CASCADE,
  "xml" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE "GroupEditorAction" (
  "groupId" UUID NOT NULL REFERENCES "GroupEditor"("groupId") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "action" JSONB NOT NULL,
  PRIMARY KEY ("groupId", "version")
);
