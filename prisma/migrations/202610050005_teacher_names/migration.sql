ALTER TABLE "TeacherAccount" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Teacher', ADD COLUMN "nameKey" TEXT;
UPDATE "TeacherAccount" SET "nameKey" = lower("id");
ALTER TABLE "TeacherAccount" ALTER COLUMN "name" DROP DEFAULT, ALTER COLUMN "nameKey" SET NOT NULL;
CREATE UNIQUE INDEX "TeacherAccount_nameKey_key" ON "TeacherAccount"("nameKey");
