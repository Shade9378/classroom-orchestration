import type { Activity, Group, Playlist } from '../types'

export function reconcileGroupWork(group: Group, activities: Activity[], playlists: Playlist[]): Group {
  const activityIds = new Set(activities.map(a => a.id))
  const assignedActivityIds = (group.assignedActivityIds ?? (group.activityId && !group.playlistId ? [group.activityId] : []))
    .filter(id => activityIds.has(id))
  const assignedPlaylistIds = (group.assignedPlaylistIds ?? (group.playlistId ? [group.playlistId] : []))
    .filter(id => playlists.some(p => p.id === id))
  const assignedPlaylists = assignedPlaylistIds.map(id => playlists.find(p => p.id === id)!)
  const allowedActivityIds = new Set([...assignedActivityIds, ...assignedPlaylists.flatMap(p => p.activityIds.filter(id => activityIds.has(id)))])
  const preferredPlaylist = assignedPlaylists.find(p => p.id === group.playlistId) ?? assignedPlaylists[0]
  const activityId = group.activityId && allowedActivityIds.has(group.activityId)
    ? group.activityId
    : assignedActivityIds[0] ?? preferredPlaylist?.activityIds.find(id => activityIds.has(id))
      ?? assignedPlaylists.flatMap(p => p.activityIds).find(id => activityIds.has(id))
  let activePlaylist = assignedPlaylists.find(p => p.id === group.playlistId)
  if (!activityId) {
    activePlaylist = undefined
  } else if (!activePlaylist?.activityIds.includes(activityId)) {
    activePlaylist = assignedActivityIds.includes(activityId)
      ? undefined : assignedPlaylists.find(p => p.activityIds.includes(activityId))
  }
  return { ...group, assignedActivityIds, assignedPlaylistIds, activityId, playlistId: activePlaylist?.id, status: activityId ? group.status : 'idle' }
}
