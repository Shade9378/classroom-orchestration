ALTER TABLE "SystemEvent" DROP CONSTRAINT "SystemEvent_groupId_fkey";
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
