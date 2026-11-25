-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "Presence" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "RecoveryPreference" AS ENUM ('AUTO', 'ASK');

-- CreateEnum
CREATE TYPE "CompletionMethod" AS ENUM ('TEACHER', 'PROJECT');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED');

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "teacherTokenHash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "Presence" NOT NULL DEFAULT 'ONLINE',

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","participantId")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "starterProjectRef" TEXT NOT NULL DEFAULT '',
    "recoveryPreference" "RecoveryPreference" NOT NULL DEFAULT 'AUTO',
    "completionMethod" "CompletionMethod" NOT NULL DEFAULT 'TEACHER',
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 10,
    "category" TEXT NOT NULL DEFAULT 'General',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityRequirement" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ActivityRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" UUID NOT NULL,
    "playlistId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAssignment" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "activityId" UUID,
    "playlistId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupActivityProgress" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "playlistItemId" UUID,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GroupActivityProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCapability" (
    "deviceId" UUID NOT NULL,
    "capability" TEXT NOT NULL,

    CONSTRAINT "DeviceCapability_pkey" PRIMARY KEY ("deviceId","capability")
);

-- CreateTable
CREATE TABLE "SessionDevice" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ONLINE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batteryLevel" INTEGER,
    "latencyMs" INTEGER,

    CONSTRAINT "SessionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAssignment" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sessionDeviceId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sessionDeviceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "groupId" UUID,
    "sessionDeviceId" UUID,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_joinCode_key" ON "Session"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_tokenHash_key" ON "Participant"("tokenHash");

-- CreateIndex
CREATE INDEX "Participant_sessionId_status_lastSeenAt_idx" ON "Participant"("sessionId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_id_sessionId_key" ON "Participant"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_id_sessionId_key" ON "Group"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_sessionId_name_key" ON "Group"("sessionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_participantId_key" ON "GroupMember"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_participantId_sessionId_key" ON "GroupMember"("participantId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistItem_playlistId_position_key" ON "PlaylistItem"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistItem_playlistId_activityId_key" ON "PlaylistItem"("playlistId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAssignment_groupId_activityId_key" ON "GroupAssignment"("groupId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAssignment_groupId_playlistId_key" ON "GroupAssignment"("groupId", "playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupActivityProgress_assignmentId_activityId_key" ON "GroupActivityProgress"("assignmentId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDevice_sessionId_deviceId_key" ON "SessionDevice"("sessionId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDevice_id_sessionId_key" ON "SessionDevice"("id", "sessionId");

-- CreateIndex
CREATE INDEX "SystemEvent_sessionId_createdAt_idx" ON "SystemEvent"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_sessionId_fkey" FOREIGN KEY ("groupId", "sessionId") REFERENCES "Group"("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_participantId_sessionId_fkey" FOREIGN KEY ("participantId", "sessionId") REFERENCES "Participant"("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRequirement" ADD CONSTRAINT "ActivityRequirement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "GroupAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "GroupAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "GroupAssignment_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActivityProgress" ADD CONSTRAINT "GroupActivityProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "GroupAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActivityProgress" ADD CONSTRAINT "GroupActivityProgress_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActivityProgress" ADD CONSTRAINT "GroupActivityProgress_playlistItemId_fkey" FOREIGN KEY ("playlistItemId") REFERENCES "PlaylistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCapability" ADD CONSTRAINT "DeviceCapability_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDevice" ADD CONSTRAINT "SessionDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDevice" ADD CONSTRAINT "SessionDevice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_groupId_sessionId_fkey" FOREIGN KEY ("groupId", "sessionId") REFERENCES "Group"("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_sessionDeviceId_sessionId_fkey" FOREIGN KEY ("sessionDeviceId", "sessionId") REFERENCES "SessionDevice"("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sessionDeviceId_fkey" FOREIGN KEY ("sessionDeviceId") REFERENCES "SessionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_sessionDeviceId_fkey" FOREIGN KEY ("sessionDeviceId") REFERENCES "SessionDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- An assignment refers to exactly one activity or playlist, as specified in Fig. 6.
ALTER TABLE "GroupAssignment" ADD CONSTRAINT "assignment_one_work_item" CHECK (("activityId" IS NOT NULL) <> ("playlistId" IS NOT NULL));
ALTER TABLE "ActivityRequirement" ADD CONSTRAINT "requirement_positive_quantity" CHECK ("quantity" > 0);
ALTER TABLE "Activity" ADD CONSTRAINT "activity_positive_time" CHECK ("estimatedMinutes" > 0);
ALTER TABLE "SessionDevice" ADD CONSTRAINT "battery_range" CHECK ("batteryLevel" BETWEEN 0 AND 100);
ALTER TABLE "SessionDevice" ADD CONSTRAINT "latency_nonnegative" CHECK ("latencyMs" >= 0);
CREATE UNIQUE INDEX "one_active_device_assignment" ON "DeviceAssignment" ("sessionDeviceId") WHERE "status" = 'ACTIVE';
