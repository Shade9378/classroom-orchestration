CREATE TABLE "WarningDismissal" (
  "id" UUID NOT NULL,
  "accountId" TEXT NOT NULL,
  "sessionId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarningDismissal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WarningDismissal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TeacherAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WarningDismissal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WarningDismissal_accountId_sessionId_fingerprint_key" ON "WarningDismissal"("accountId", "sessionId", "fingerprint");
CREATE INDEX "WarningDismissal_sessionId_idx" ON "WarningDismissal"("sessionId");
