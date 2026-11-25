ALTER TABLE "Activity" ADD COLUMN "starterProjectName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GroupEditorAction" DROP CONSTRAINT "GroupEditorAction_groupId_fkey";
ALTER TABLE "GroupEditor" DROP CONSTRAINT "GroupEditor_pkey", ADD COLUMN "workspaceKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "revision" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "GroupEditor" ALTER COLUMN "revision" DROP DEFAULT, ADD PRIMARY KEY ("groupId", "workspaceKey");
ALTER TABLE "GroupEditorAction" DROP CONSTRAINT "GroupEditorAction_pkey", ADD COLUMN "workspaceKey" TEXT NOT NULL DEFAULT '', ADD PRIMARY KEY ("groupId", "workspaceKey", "version"), ADD FOREIGN KEY ("groupId", "workspaceKey") REFERENCES "GroupEditor"("groupId", "workspaceKey") ON DELETE CASCADE;
