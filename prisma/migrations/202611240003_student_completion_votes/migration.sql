CREATE TABLE "GroupCompletionVote" (
  "progressId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupCompletionVote_pkey" PRIMARY KEY ("progressId", "participantId")
);
CREATE INDEX "GroupCompletionVote_groupId_participantId_idx" ON "GroupCompletionVote"("groupId", "participantId");
ALTER TABLE "GroupCompletionVote" ADD CONSTRAINT "GroupCompletionVote_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "GroupActivityProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupCompletionVote" ADD CONSTRAINT "GroupCompletionVote_groupId_participantId_fkey" FOREIGN KEY ("groupId", "participantId") REFERENCES "GroupMember"("groupId", "participantId") ON DELETE CASCADE ON UPDATE CASCADE;
