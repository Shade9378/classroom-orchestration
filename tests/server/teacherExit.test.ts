import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { WebSocket } from 'ws'
import { expect, test, vi } from 'vitest'
import { buildApp } from '../../server/app.js'

test('teacher exit waits for the last tab, tolerates refresh, and sign-out closes every session', async () => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_')) throw new Error('Use the isolated test database.')
  const db = new PrismaClient()
  const { app, service } = await buildApp(db, { teacherExitGraceMs: 300, presenceIntervalMs: 3600000 })
  const sockets: WebSocket[] = []
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const response = await app.inject({ method: 'POST', url: '/api/teacher/register', payload: { name: 'Exit teacher ' + randomUUID(), password: 'Teacher test password' } })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    const first = await service.createSession('Exit first ' + randomUUID())
    const second = await service.createSession('Exit second ' + randomUUID())
    await service.createGroup(first.session.id, 'Group')
    const student = await service.join(first.session.joinCode, 'Exit student ' + randomUUID())
    const connect = () => new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(address.replace('http:', 'ws:') + '/api/live', { headers: { Cookie: cookie } })
      sockets.push(socket)
      socket.once('error', reject)
      socket.once('open', () => socket.send(JSON.stringify({ teacher: true })))
      socket.once('message', raw => { expect(JSON.parse(raw.toString()).type).toBe('ready'); resolve(socket) })
    })
    const one = await connect(), two = await connect()
    one.close()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect((await service.state(first.session.id)).session!.status).toBe('open')
    two.close()
    const refreshed = await connect()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect((await service.state(second.session.id)).session!.status).toBe('open')
    refreshed.close()
    await vi.waitFor(async () => expect((await service.state(first.session.id)).session!.status).toBe('closed'), { timeout: 2000 })
    expect((await service.state(second.session.id)).session!.status).toBe('closed')
    expect((await service.state(first.session.id)).students[0].status).toBe('offline')
    await service.setSessionStatus(first.session.id, 'OPEN')
    await service.setSessionStatus(second.session.id, 'OPEN')
    expect((await app.inject({ method: 'POST', url: '/api/teacher/logout', headers: { cookie }, payload: {} })).statusCode).toBe(200)
    expect((await service.state(first.session.id)).session!.status).toBe('closed')
    expect((await service.state(second.session.id)).session!.status).toBe('closed')
    expect((await app.inject({ method: 'POST', url: '/api/participants/heartbeat', payload: { token: student.token } })).statusCode).toBe(409)
    await service.setSessionStatus(first.session.id, 'OPEN')
    await app.inject({ method: 'POST', url: '/api/teacher/logout', payload: {} })
    expect((await service.state(first.session.id)).session!.status).toBe('open')
  } finally { for (const socket of sockets) socket.terminate(); await app.close(); await db.$disconnect() }
})
