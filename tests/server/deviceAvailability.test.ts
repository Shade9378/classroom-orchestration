import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from 'vitest'
import { buildApp } from '../../server/app.js'
import { getClassroomAlerts } from '../../src/state/classroomAlerts.js'
import type { Activity, Device, Group } from '../../src/types.js'

test('every offline incident stays flagged and replacements require current teacher approval', async () => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_')) throw new Error('Use the isolated test database.')
  const db = new PrismaClient()
  const { app, service } = await buildApp(db, { presenceIntervalMs: 3600000 })
  try {
    await app.ready()
    const { session, teacherToken } = await service.createSession('Manual replacement ' + randomUUID())
    const group = await service.createGroup(session.id, 'Group 1')
    const failed = await service.registerDevice(session.id, { name: 'Original robot', type: 'Robot', capabilities: ['Robot'], status: 'OFFLINE' })
    const available = await service.registerDevice(session.id, { name: 'Spare robot', type: 'Robot', capabilities: ['Robot'], status: 'ONLINE' })
    await service.assignDevices(session.id, group.id, [failed.id])
    const snapshot = await service.state(session.id)
    const plan = snapshot.groups[0].replacements[0]
    expect(plan.replacementDeviceId).toBe(available.id)
    expect(snapshot.groups[0].deviceIds).toEqual([failed.id])
    expect((await service.state(session.id)).groups[0].deviceIds).toEqual([failed.id])
    const alerts = getClassroomAlerts({ activities: snapshot.activities as Activity[], groups: snapshot.groups as Group[], devices: snapshot.devices as Device[], sessionOpen: true, onReview: () => {}, onReplacement: async () => {} })
    expect(alerts).toContainEqual(expect.objectContaining({ severity: 'error', title: 'Original robot (Robot) disconnected', approvalLabel: 'Approve replacement', approve: expect.any(Function), reject: expect.any(Function) }))
    const url = '/api/sessions/' + session.id + '/device-assignments/replacement'
    expect((await app.inject({ method: 'POST', url, payload: { ...plan, decision: 'approve' } })).statusCode).toBe(403)
    const review = (data: object) => app.inject({ method: 'POST', url, headers: { 'x-teacher-token': teacherToken }, payload: data })
    expect((await review({ ...plan, decision: 'reject' })).statusCode).toBe(200)
    const rejected = await service.state(session.id)
    expect(rejected.groups[0].deviceIds).toEqual([failed.id])
    expect(rejected.groups[0].replacements[0]).toMatchObject({ rejected: true, replacementDeviceId: null })
    await db.sessionDevice.update({ where: { id: failed.id }, data: { status: 'ONLINE' } })
    expect((await service.state(session.id)).groups[0].replacements).toEqual([])
    await db.sessionDevice.update({ where: { id: failed.id }, data: { status: 'OFFLINE' } })
    await db.systemEvent.create({ data: { sessionId: session.id, groupId: group.id, sessionDeviceId: failed.id, type: 'DEVICE_OFFLINE', message: 'Disconnected again.' } })
    const next = (await service.state(session.id)).groups[0].replacements[0]
    expect(next.failureKey).not.toBe(plan.failureKey)
    expect(next.rejected).toBe(false)
    expect((await review({ ...plan, decision: 'approve' })).statusCode).toBe(409)
    await db.sessionDevice.update({ where: { id: available.id }, data: { status: 'OFFLINE' } })
    expect((await review({ ...next, decision: 'approve' })).statusCode).toBe(409)
    await db.sessionDevice.update({ where: { id: available.id }, data: { status: 'ONLINE' } })
    expect((await review({ ...next, decision: 'approve' })).statusCode).toBe(200)
    expect((await service.state(session.id)).groups[0].deviceIds).toEqual([available.id])
  } finally { await app.close(); await db.$disconnect() }
})
