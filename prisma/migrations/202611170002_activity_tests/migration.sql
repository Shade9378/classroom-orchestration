ALTER TABLE "Activity" ADD COLUMN "testConfig" JSONB;
ALTER TABLE "GroupActivityProgress" ADD COLUMN "submissionId" UUID, ADD COLUMN "testResult" JSONB;
