import type { Activity, Device, Group, HardwareRequirement, Playlist } from '../types.js'

const normalize = (value: string) => value.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase()

export function deviceMatchesRequirement(device: Pick<Device,'type'|'capability'|'capabilities'>, capability: string) {
  const required = normalize(capability)
  const available = (device.capabilities ?? [device.capability]).map(normalize)
  const type = normalize(device.type)
  if (required === 'any sensor') return available.some(c => c.includes('sensor') || c === 'accelerometer') || type === 'sensor'
  if (required === 'phone / tablet') return available.some(c => ['phone', 'tablet', 'phone / tablet'].includes(c)) || ['phone', 'tablet'].includes(type)
  return available.includes(required) || type === required
}

export function missingHardwareRequirements(requirements: HardwareRequirement[], devices: Device[], includeOffline = false) {
  const pool = includeOffline ? devices : devices.filter(d => d.status === 'online')
  const used = new Set<string>()
  const missing: HardwareRequirement[] = []
  const ordered = [...requirements].sort((a, b) => Number(a.capability === 'Any Sensor') - Number(b.capability === 'Any Sensor'))
  for (const requirement of ordered) {
    const matching = pool.filter(d => !used.has(d.id) && deviceMatchesRequirement(d, requirement.capability))
    matching.slice(0, requirement.quantity).forEach(d => used.add(d.id))
    const quantity = requirement.quantity - Math.min(matching.length, requirement.quantity)
    if (quantity > 0) missing.push({ ...requirement, quantity })
  }
  return missing
}

export function deviceRequirementWarning(devices:Device[],activity?:Pick<Activity,'name'|'requirements'>&{hasAssignedWork?:boolean}){
  if(!activity||activity.hasAssignedWork===false)return null
  const unnecessary=devices.filter(d=>!activity.requirements.some(r=>deviceMatchesRequirement(d,r.capability)))
  if(!unnecessary.length)return null
  return `${unnecessary.map(d=>d.name).join(', ')} ${unnecessary.length===1?'is':'are'} not required for the assignment "${activity.name}". Assign anyway?`
}

export function combineHardwareRequirements(activities:Pick<Activity,'requirements'>[]) {
  const maximum=new Map<string,HardwareRequirement>()
  for(const activity of activities){
    const totals=new Map<string,HardwareRequirement>()
    for(const requirement of activity.requirements){
      const key=normalize(requirement.capability),previous=totals.get(key)
      totals.set(key,{id:requirement.id,capability:requirement.capability,quantity:requirement.quantity+(previous?.quantity??0)})
    }
    for(const [key,requirement] of totals)if(requirement.quantity>(maximum.get(key)?.quantity??0))maximum.set(key,requirement)
  }
  return [...maximum.values()]
}

export function groupHardwareAssignment(group:Group,activities:Activity[],playlists:Playlist[]) {
  const activityIds=new Set(group.assignedActivityIds??(group.activityId&&!group.playlistId?[group.activityId]:[]))
  const playlistIds=group.assignedPlaylistIds??(group.playlistId?[group.playlistId]:[])
  for(const playlist of playlists.filter(p=>playlistIds.includes(p.id)))for(const id of playlist.activityIds)activityIds.add(id)
  return {name:`${group.name}'s assigned work`,hasAssignedWork:activityIds.size>0,requirements:combineHardwareRequirements(activities.filter(a=>activityIds.has(a.id)))}
}
