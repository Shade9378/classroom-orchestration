import type { Activity, Device, DeviceReplacement, Group } from '../types.js'
import { deviceMatchesRequirement, missingHardwareRequirements } from './hardware.js'

type Candidate = Pick<Device, 'id' | 'name' | 'type' | 'capability' | 'capabilities' | 'status' | 'assignedGroupId' | 'control' | 'disconnectKey'> & {
  runtime?: { mode: string; serviceName?: string | null; remoteDeviceId?: string | null } | null
}
type WorkGroup = Pick<Group, 'id' | 'name' | 'activityId' | 'progress' | 'deviceIds'>
export const rejectionPrefix = 'MANUAL_REPLACEMENT_REJECTED:'

export function planDeviceReplacements(groups: WorkGroup[], activities: Pick<Activity, 'id' | 'requirements'>[], devices: Candidate[], rejected = new Set<string>()): DeviceReplacement[] {
  return groups.flatMap(group => devices.filter(device => device.status === 'offline' && device.assignedGroupId === group.id).map(failed => {
    const failureKey = group.id + ':' + failed.id + ':' + (failed.disconnectKey ?? 'offline')
    const wasRejected = rejected.has(failureKey)
    const active = activities.find(activity => activity.id === group.activityId)
    const available = devices.filter(device => device.assignedGroupId === group.id && device.status === 'online')
    const needed = active ? missingHardwareRequirements(active.requirements, available as Device[]).filter(requirement => deviceMatchesRequirement(failed, requirement.capability)) : []
    const candidates = wasRejected ? [] : devices.filter(candidate => {
      if (candidate.id === failed.id || candidate.status !== 'online' || candidate.control || candidate.assignedGroupId === group.id) return false
      if (candidate.runtime?.mode !== failed.runtime?.mode || candidate.runtime?.serviceName !== failed.runtime?.serviceName) return false
      if (failed.runtime?.remoteDeviceId && candidate.runtime?.remoteDeviceId === failed.runtime.remoteDeviceId) return false
      const requirements = needed.length ? needed.map(requirement => requirement.capability) : failed.capabilities?.length ? failed.capabilities : [failed.capability || failed.type]
      if (!requirements.every(requirement => deviceMatchesRequirement(candidate, requirement))) return false
      if (!candidate.assignedGroupId) return true
      const donor = groups.find(item => item.id === candidate.assignedGroupId)
      if (!donor) return false
      const remaining = donor.progress?.length ? donor.progress.filter(progress => progress.status !== 'completed').map(progress => progress.activityId) : donor.activityId ? [donor.activityId] : []
      return !activities.filter(activity => remaining.includes(activity.id)).some(activity => activity.requirements.some(requirement => deviceMatchesRequirement(candidate, requirement.capability)))
    }).sort((a, b) => Number(!!a.assignedGroupId) - Number(!!b.assignedGroupId) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return { groupId: group.id, failedDeviceId: failed.id, replacementDeviceId: candidates[0]?.id ?? null, sourceGroupId: candidates[0]?.assignedGroupId ?? null, failureKey, rejected: wasRejected }
  }))
}
