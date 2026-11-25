export type HardwareRequirement = {
  id: string
  capability: string
  quantity: number
}

export type TestValue = number | string | boolean | TestValue[]
export type ActivityTestConfig = { spec: string; cases: string }
export type ActivityTestResult = { passed: boolean; cases: { passed: boolean; detail: string }[] }

export type Activity = {
  testConfig?: ActivityTestConfig
  id: string
  name: string
  description: string
  starterProject: string
  starterProjectName?: string
  requirements: HardwareRequirement[]
  completionMethod: 'student' | 'teacher' | 'project'
  estimatedMinutes: number
  category?: string
}

export type Playlist = {
  id: string
  name: string
  description: string
  activityIds: string[]
}

export type Student = {
  id: string
  name: string
  status: 'online' | 'away' | 'offline'
  groupId?: string
}

export type Device = {
  id: string
  name: string
  capability: string
  capabilities?: string[]
  type: string
  status: 'online' | 'offline' | 'degraded'
  control?: {participantId:string|null;name:string;expiresAt:string}
  assignedGroupId?: string
  disconnectKey?: string
  batteryLevel?: number|null
  latencyMs?: number|null
  runtime?: {mode:'simulated'|'bluetooth'|'iotscape'|'roboscape'|'phoneiot';serviceName?:string|null;remoteDeviceId?:string|null;profile:string;model:string;manufacturer:string;state:string;paired:boolean;services:string[];intervalMs:number;packetLoss:number;telemetry:import('./devices/profiles.js').Readings;sampledAt:string|null;controls:import('./devices/profiles.js').SimControls}
}

export type DeviceReplacement = { groupId: string; failedDeviceId: string; replacementDeviceId: string | null; sourceGroupId: string | null; failureKey: string; rejected: boolean }

export type GroupChatMessage = { type: 'group-message'; id: string; groupId: string; senderId: string; senderName: string; text: string; kind: 'message' | 'review' | 'help'; context?: string | null; createdAt: string; resolvedAt?: string | null }
export type HelpRequest = { id: string; senderName: string; text: string }

export type Group = {
  replacements?: DeviceReplacement[]
  messages?: GroupChatMessage[]
  helpRequests?: HelpRequest[]
  id: string
  name: string
  studentIds: string[]
  activityId?: string
  playlistId?: string
  assignedActivityIds?: string[]
  assignedPlaylistIds?: string[]
  status: 'running' | 'idle' | 'degraded' | 'blocked'
  deviceIds: string[]
  progress?: { id?: string; submissionId?: string | null; testResult?: ActivityTestResult | null; completionVotes?:number;requiredVotes?:number; activityId: string; playlistId?: string | null; status: 'not_started'|'in_progress'|'submitted'|'completed' }[]
}

export type AutoDeviceAssignmentResult = {
  assignedCount: number
  shortages: {groupId:string;groupName:string;requirements:HardwareRequirement[]}[]
}
