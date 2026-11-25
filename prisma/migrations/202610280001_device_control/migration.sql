CREATE TABLE "DeviceControl" (
  "sourceKey" TEXT PRIMARY KEY,
  "sessionDeviceId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "ownerTokenHash" TEXT NOT NULL,
  "groupId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "mode" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "remoteDeviceId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "DeviceControl_participantId_idx" ON "DeviceControl"("participantId");
CREATE TABLE "DeviceRun" (
  "participantId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "finished" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("participantId", "runId")
);
