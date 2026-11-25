export type StudentConnection = { token: string; joinCode: string; name: string; sessionId: string }
export type StudentState = {
  session: { id: string; name: string; joinCode: string; status: 'open'|'closed' }
  participant: { id: string; name: string }
  devices?: {id:string;name:string;service:string;deviceId:string;status:string;control?:{participantId:string|null;name:string;expiresAt:string}}[]
  managedDeviceServices?:string[]
  heartbeatIntervalMs: number
  group: { id: string; name: string; members: { id: string; name: string; status: string }[]; assignments: { id: string; kind: string; name: string; activities: { id: string; name: string }[] }[] } | null
  messages?: GroupMessage[]
  helpPending?: boolean
  finishedAssignedWork?: boolean
  activity: { id: string; name: string; description: string; starterProject: string; progressId: string; awaitingReview: boolean; completionVote?: {agreed:number;total:number;hasVoted:boolean;pendingNames:string[]}; testing?: boolean; testsFailed?: boolean; completionMethod: import('../types').Activity['completionMethod'] } | null
}
export type GroupMessage = import('../types').GroupChatMessage
