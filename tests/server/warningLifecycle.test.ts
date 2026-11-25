import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import { buildApp } from '../../server/app.js'

test('a resolved warning loses its saved dismissals without a dashboard request', async () => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_')) throw new Error('Use the isolated test database.')
  const db = new PrismaClient()
  const { app, service } = await buildApp(db, { presenceIntervalMs: 3600000 })
  try {
    await app.ready()
    const teacherName = 'Warning lifecycle ' + randomUUID()
    expect((await app.inject({ method: 'POST', url: '/api/teacher/register', payload: { name: teacherName, password: 'Teacher test password' } })).statusCode).toBe(200)
    const account = await db.teacherAccount.findUniqueOrThrow({ where: { nameKey: teacherName.toLowerCase() } })
    const { session } = await service.createSession('Warning lifecycle class ' + randomUUID())
    const device = await service.registerDevice(session.id, { name: 'Phone', type: 'Phone', capabilities: ['Phone'], status: 'ONLINE' })
    await db.sessionDevice.update({ where: { id: device.id }, data: { batteryLevel: 20 } })
    const fingerprint = JSON.stringify(['battery-' + device.id, 'warning', 'Phone (Phone) battery low', null])
    await db.warningDismissal.create({ data: { accountId: account.id, sessionId: session.id, fingerprint } })
    expect((await service.state(session.id, true, account.id)).dismissedWarningKeys).toEqual([fingerprint])
    await db.sessionDevice.update({ where: { id: device.id }, data: { batteryLevel: 80 } })
    await vi.waitFor(async () => expect(await db.warningDismissal.count({ where: { sessionId: session.id } })).toBe(0), { timeout: 4000 })
    await db.sessionDevice.update({ where: { id: device.id }, data: { batteryLevel: 20 } })
    expect((await service.state(session.id, true, account.id)).dismissedWarningKeys).toEqual([])
  } finally {
    await app.close()
    await db.$disconnect()
  }
})
