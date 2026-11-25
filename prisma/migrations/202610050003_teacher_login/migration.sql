CREATE TABLE "TeacherAccount" ("id" TEXT PRIMARY KEY, "passwordHash" TEXT NOT NULL, "salt" TEXT NOT NULL);
CREATE TABLE "TeacherLogin" ("tokenHash" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "TeacherAccount"("id") ON DELETE CASCADE, "expiresAt" TIMESTAMP(3) NOT NULL);
