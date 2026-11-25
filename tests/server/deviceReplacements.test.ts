import { expect, test } from 'vitest'
import { planDeviceReplacements } from '../../src/state/deviceReplacements.js'
import type { Activity, Device, Group } from '../../src/types.js'
const robot = (id: string, assignedGroupId?: string): Device => ({ id, name: id, type: 'Robot', capability: 'Robot', status: 'online', assignedGroupId })
const work: Activity = { id: 'work', name: 'Work', description: '', starterProject: '', estimatedMinutes: 5, completionMethod: 'teacher', requirements: [{ id: 'r', capability: 'Robot', quantity: 1 }] }
const group = (id: string): Group => ({ id, name: id, deviceIds: [], studentIds: [], status: 'running' })
test('donor devices are offered only after every exercise needing them is complete', () => {
  const recipient = { ...group('recipient'), activityId: work.id }
  const donor: Group = { ...group('donor'), progress: [{ activityId: work.id, status: 'not_started' as const }] }
  const failed = { ...robot('failed', recipient.id), status: 'offline' as const }
  const borrowed = robot('borrowed', donor.id)
  expect(planDeviceReplacements([recipient, donor], [work], [failed, borrowed])[0].replacementDeviceId).toBeNull()
  donor.progress![0].status = 'completed'
  expect(planDeviceReplacements([recipient, donor], [work], [failed, borrowed])[0]).toMatchObject({ replacementDeviceId: borrowed.id, sourceGroupId: donor.id })
  const spare = robot('spare')
  expect(planDeviceReplacements([recipient, donor], [work], [failed, borrowed, spare])[0]).toMatchObject({ replacementDeviceId: spare.id, sourceGroupId: null })
  spare.control = { participantId: 'student', name: 'Student', expiresAt: new Date(Date.now() + 10000).toISOString() }
  expect(planDeviceReplacements([recipient, donor], [work], [failed, spare])[0].replacementDeviceId).toBeNull()
})
