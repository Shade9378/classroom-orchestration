import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from 'vitest'
import { buildApp } from '../../server/app.js'

test('group chat and help requests enforce membership, validation, lifecycle, and teacher authorization', async () => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_')) throw new Error('Use the isolated test database.')
  const db = new PrismaClient()
  const { app, service } = await buildApp(db, { presenceIntervalMs: 3600000 })
  try {
    await app.ready()
    const { session, teacherToken } = await service.createSession('Chat API ' + randomUUID())
    const other = await service.createSession('Other chat API ' + randomUUID())
    const group = await service.createGroup(session.id, 'Team')
    const privateGroup = await service.createGroup(session.id, 'Private team')
    const first = await service.join(session.joinCode, 'First')
    const second = await service.join(session.joinCode, 'Second')
    const outsider = await service.join(session.joinCode, 'Outsider')
    const unassigned = await service.join(session.joinCode, 'Unassigned')
    await service.moveStudents(session.id, group.id, [first.participantId, second.participantId])
    await service.moveStudents(session.id, privateGroup.id, [outsider.participantId])
    const teacherHeaders = { 'x-teacher-token': teacherToken }
    const studentHeaders = { authorization: 'Bearer ' + first.token }
    const url = '/api/sessions/' + session.id + '/groups/' + group.id
    expect((await app.inject({ method: 'POST', url: url + '/messages', headers: studentHeaders, payload: { text: 'Intruder teacher' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: url + '/messages', headers: { 'x-teacher-token': other.teacherToken }, payload: { text: 'Wrong class' } })).statusCode).toBe(403)
    for (const text of ['', ' ', 'x'.repeat(1001)]) expect((await app.inject({ method: 'POST', url: '/api/student/help', headers: studentHeaders, payload: { text } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/student/help', headers: { authorization: 'Bearer ' + unassigned.token }, payload: { text: 'Help' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: url + '/messages', headers: teacherHeaders, payload: { text: 'Teacher here' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/student/messages', headers: studentHeaders, payload: { text: 'Student here' } })).statusCode).toBe(200)
    const requests = await Promise.all([first, second].map(student => app.inject({ method: 'POST', url: '/api/student/help', headers: { authorization: 'Bearer ' + student.token }, payload: { text: 'We need help' } })))
    expect(requests.map(response => response.statusCode).sort()).toEqual([200, 409])
    const request = requests.find(response => response.statusCode === 200)!.json()
    const state = await service.studentState(second.token)
    expect(state.helpPending).toBe(true)
    expect(state.messages.map(message => message.text)).toEqual(['Teacher here', 'Student here', 'We need help'])
    expect((await service.studentState(outsider.token)).messages).toEqual([])
    expect((await service.state(session.id)).groups.find(g => g.id === group.id)?.helpRequests).toHaveLength(1)
    const resolveUrl = url + '/help/' + request.id + '/resolve'
    expect((await app.inject({ method: 'POST', url: resolveUrl, headers: studentHeaders, payload: {} })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: resolveUrl, headers: teacherHeaders, payload: {} })).statusCode).toBe(200)
    expect((await service.studentState(first.token)).helpPending).toBe(false)
    expect((await app.inject({ method: 'POST', url: '/api/student/help', headers: studentHeaders, payload: { text: 'A new problem' } })).statusCode).toBe(200)
    await service.setSessionStatus(session.id, 'CLOSED')
    expect((await app.inject({ method: 'POST', url: url + '/messages', headers: teacherHeaders, payload: { text: 'Closed class' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/api/student/help', headers: studentHeaders, payload: { text: 'Closed request' } })).statusCode).toBe(409)
    await db.group.delete({ where: { id: group.id } })
    expect(await db.groupChatMessage.count({ where: { groupId: group.id } })).toBe(0)
  } finally { await app.close(); await db.$disconnect() }
})
