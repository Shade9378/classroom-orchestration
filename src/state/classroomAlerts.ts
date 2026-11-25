import type { Activity, Device, Group, DeviceReplacement } from '../types.js'
import { deviceMatchesRequirement, missingHardwareRequirements } from './hardware.js'

export type ClassroomAlert = {
  key: string
  severity: 'notice' | 'warning' | 'error'
  title: string
  detail: string
  dismiss?: () => Promise<void>
  approve?: () => Promise<void>
  reject?: () => Promise<void>
  approvalLabel?: string
}


type AlertContext = {
  activities: Activity[]
  devices: Device[]
  groups: Group[]
  sessionOpen: boolean
  onReplacement?: (plan: DeviceReplacement, decision: 'approve' | 'reject') => Promise<void>
  onReview: (groupId: string) => void
  onOpenChat?: (groupId: string) => void
}

const deviceLabel = (device: Device) => device.name + ' (' + device.type + ')'

export const canDismissAlert = (alert: ClassroomAlert) => alert.severity !== 'error'

export const alertFingerprint = (alert: ClassroomAlert) => JSON.stringify([alert.key, alert.severity, alert.title, alert.approvalLabel])

export function getClassroomAlerts({ activities, devices, groups, sessionOpen, onReview, onOpenChat = onReview, onReplacement }: AlertContext): ClassroomAlert[] {
  const activityForGroup = (group: Group) => activities.find(a => a.id === group.activityId)
  const devicesForGroup = (group: Group) => devices.filter(d => group.deviceIds.includes(d.id) || d.assignedGroupId === group.id)
  const lowBatteryAlerts=devices.filter(d=>d.status!=='offline'&&typeof d.batteryLevel==='number'&&Number.isFinite(d.batteryLevel)&&d.batteryLevel>=0&&d.batteryLevel<=20).map(d=>({
    key:`battery-${d.id}`,severity:d.batteryLevel!<5?'error' as const:'warning' as const,title:`${deviceLabel(d)} battery ${d.batteryLevel!<5?'critically low':'low'}`,
    detail:`${groups.find(g=>g.id===d.assignedGroupId)?.name??'Unassigned device'} - ${d.batteryLevel}% battery remaining${d.status==='offline'?' (last reported)':''}.`,
  }))
  return [...lowBatteryAlerts,...groups.flatMap(g => {
    const gActivity = activityForGroup(g)
    const gDevices = devicesForGroup(g)
    const alerts: ClassroomAlert[] = (g.helpRequests ?? []).map(request => ({
      key: 'help-' + request.id, severity: 'warning', title: g.name + ' needs help',
      detail: request.senderName + ': ' + request.text,
      approvalLabel: 'View group chat', approve: async () => { onOpenChat(g.id) },
    }))
    if (sessionOpen && g.progress?.some(p => p.status === 'submitted')) {
      alerts.push({
        key: 'review-' + g.id + '-' + (g.progress?.find(progress => progress.status === 'submitted')?.submissionId ?? g.activityId ?? ''),
        severity: 'notice',
        title: g.name + ' submitted an exercise',
        detail: gActivity?.name ?? 'Waiting for teacher review.',
        approvalLabel: 'Review exercise',
        approve: async () => {
          onReview(g.id)
        },
      })
    }
    const explainedCapabilities = new Set<string>()

    gDevices.filter(d => d.status === 'offline').forEach(d => {
      const requirement = gActivity?.requirements.find(r => deviceMatchesRequirement(d, r.capability))
      const availableCount = gDevices.filter(candidate => candidate.status === 'online' && deviceMatchesRequirement(candidate, requirement?.capability ?? d.capability)).length
      const affectsCurrentActivity = !!requirement && availableCount < requirement.quantity
      if (affectsCurrentActivity) explainedCapabilities.add(requirement!.capability)

      const plan = g.replacements?.find(item => item.failedDeviceId === d.id)
      const replacement = devices.find(item => item.id === plan?.replacementDeviceId)
      const donor = groups.find(item => item.id === plan?.sourceGroupId)
      const suggestion = replacement ? ' Approve ' + deviceLabel(replacement) + (donor ? ' from ' + donor.name + '; none of that group\'s remaining exercises needs it.' : ' as the replacement.') : plan?.rejected ? ' Replacement rejected; the device remains disconnected.' : plan ? ' No compatible replacement is available.' : ''
      alerts.push({
        key: `offline-${g.id}-${d.id}-${d.disconnectKey ?? 'offline'}`,
        approvalLabel: donor ? 'Approve transfer' : 'Approve replacement',
        approve: sessionOpen && plan && replacement && onReplacement ? () => onReplacement(plan, 'approve') : undefined,
        reject: sessionOpen && plan && replacement && onReplacement ? () => onReplacement(plan, 'reject') : undefined,
        severity: 'error',
        title: `${deviceLabel(d)} disconnected`,
        detail: affectsCurrentActivity && gActivity
          ? `${g.name} lost the ${d.capability} required for ${gActivity.name}.` + suggestion
          : `${deviceLabel(d)} is assigned to ${g.name} but is currently offline.` + suggestion,
      })
    })

    gDevices.filter(d => d.status === 'degraded').forEach(d => {
      alerts.push({
        key: `degraded-${g.id}-${d.id}`,
        severity: 'warning',
        title: `${deviceLabel(d)} connection degraded`,
        detail: `${g.name} may receive unreliable ${d.capability} data${gActivity ? ` during ${gActivity.name}` : ''}.`,
      })
    })

    if (gActivity) {
      missingHardwareRequirements(gActivity.requirements, gDevices).forEach(missing => {
        const requirement = gActivity.requirements.find(r => r.id === missing.id)!
        const availableCount = requirement.quantity - missing.quantity
        if (explainedCapabilities.has(requirement.capability)) return

        const missingCount = missing.quantity
        const severity: 'error'|'warning' = g.status === 'running' || g.status === 'degraded' || g.status === 'blocked' ? 'error' : 'warning'
        alerts.push({
          key: `missing-${g.id}-${requirement.id}`,
          severity,
          title: severity === 'error'
            ? `${g.name} cannot continue ${gActivity.name}`
            : `${g.name} not ready for ${gActivity.name}`,
          detail: `Missing ${missingCount} x ${requirement.capability}; ${availableCount}/${requirement.quantity} required available.`,
        })
      })
    }

    return alerts
  })]

}

export const alertSeverityIcon = { notice: 'info', warning: 'alert', error: 'error' } as const
