CREATE TABLE "DeviceRuntime" (
 "sessionDeviceId" UUID NOT NULL PRIMARY KEY,
 "mode" TEXT NOT NULL, "profile" TEXT NOT NULL, "model" TEXT NOT NULL, "manufacturer" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'disconnected', "paired" BOOLEAN NOT NULL DEFAULT false,
 "bluetoothId" TEXT, "services" JSONB NOT NULL DEFAULT '[]',
 "intervalMs" INTEGER NOT NULL DEFAULT 1000, "latencyMs" INTEGER NOT NULL DEFAULT 40,
 "packetLoss" INTEGER NOT NULL DEFAULT 0, "battery" DOUBLE PRECISION NOT NULL DEFAULT 100,
 "telemetry" JSONB NOT NULL DEFAULT '{}', "controls" JSONB NOT NULL DEFAULT '{}',
 "sampledAt" TIMESTAMP(3), "connectedAt" TIMESTAMP(3), "tokenHash" TEXT,
 CONSTRAINT "DeviceRuntime_sessionDeviceId_fkey" FOREIGN KEY ("sessionDeviceId") REFERENCES "SessionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
