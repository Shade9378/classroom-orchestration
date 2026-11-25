import { DeviceProvisioning } from './deviceProvisioning.js'
import { registerNetsBloxDevices,type NetsBloxDevices } from './netsbloxDevices.js'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { Prisma, PrismaClient } from '@prisma/client'
import { z, ZodError } from 'zod'
import type { WebSocket } from 'ws'
import { registerGroupEditor, resetGroupEditor, viewGroupEditor } from './groupEditor.js'
import { registerTeacherAuth } from './teacherAuth.js'
import type { FastifyRequest } from 'fastify'
import { registerDeviceHub } from './deviceHub.js'
import { parseActivityTests, isTestValue } from '../src/state/activityTests.js'
import { ApiError, ClassroomService } from './service.js'

const uuid = z.string().uuid()
const ids = z.array(uuid).min(1).max(100).refine(a => new Set(a).size === a.length, 'IDs must be unique')
const name = z.string().trim().min(1).max(100)
const activitySchema = z.object({ testConfig: z.object({ spec: z.string().trim().max(300), cases: z.string().max(16000) }).optional(), id: uuid, name, description: z.string().max(500), starterProject: z.string().max(750000), starterProjectName: z.string().max(255).optional(), estimatedMinutes: z.number().int().min(1).max(1440), category: z.string().max(100).optional(), completionMethod: z.enum(['student','teacher','project']), requirements: z.array(z.object({ id: uuid, capability: name, quantity: z.number().int().min(1).max(100) })).max(50).refine(a => new Set(a.map(r => r.id)).size === a.length, 'Requirement IDs must be unique') })
const playlistSchema = z.object({ id: uuid, name, description: z.string().max(500), activityIds: z.array(uuid).max(100).refine(a => new Set(a).size === a.length, 'An activity may occur once per playlist') })
const sessionParams = z.object({ sessionId: uuid })
const work = z.object({ kind: z.enum(['activity','playlist']), id: uuid })

export async function buildApp(db: PrismaClient, options: { timeoutMs?: number; now?: () => Date; presenceIntervalMs?: number; awayTimeoutMs?:number; netsbloxDevices?:NetsBloxDevices;deviceProvisioningPort?:number;enableLocalDeviceTesting?:boolean;teacherExitGraceMs?:number } = {}) {
  const app = Fastify({ logger: { level: 'error' }, bodyLimit: 1024 * 1024 })
  const service = new ClassroomService(db, options.timeoutMs, options.now, options.awayTimeoutMs)
  await app.register(cors, { origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://editor.netsblox.org'], allowedHeaders: ['Content-Type', 'x-teacher-token', 'Authorization'] })
  await app.register(websocket, { options: { maxPayload: 4096 } })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: error.issues[0]?.message ?? 'Invalid request.' })
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ message: error.message })
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return reply.code(404).send({ message: 'The selected record no longer exists.' })
      if (['P2002','P2003','P2004','P2034'].includes(error.code)) return reply.code(409).send({ message: 'The change conflicts with the current classroom state. Refresh and try again.' })
    }
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ message: 'Invalid request body or content type.' })
    app.log.error(error)
    reply.code(500).send({ message: 'The server could not complete this request.' })
  })
  await registerGroupEditor(app,db,service)
  const subscribers = new Set<WebSocket>()
  const students = new Map<WebSocket, string>()
  const studentTokens = new Map<WebSocket,string>()
  const pongTimes = new Map<WebSocket,number>()
  const notify = () => { for (const socket of subscribers) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'changed' })) }
  const changed = async <T>(action: Promise<T>) => { const result = await action; notify(); return (result ?? { ok: true }) as T }
  const teacherSockets = new Map<WebSocket, string>()
  let teacherExitTimer: ReturnType<typeof setTimeout> | undefined
  let shuttingDown = false
  const teacherAuth = await registerTeacherAuth(app, db, { onLogout: async () => {
    await service.closeOpenSessions('Session closed because the teacher signed out.')
    notify()
  } })
  const teacherDisconnected = (socket: WebSocket) => {
    if (!teacherSockets.delete(socket) || teacherSockets.size || shuttingDown || options.teacherExitGraceMs === undefined) return
    clearTimeout(teacherExitTimer)
    teacherExitTimer = setTimeout(() => {
      if (teacherSockets.size || shuttingDown) return
      void service.closeOpenSessions('Session closed because the last teacher dashboard disconnected.').then(count => { if (count) notify() }).catch(error => app.log.error(error))
    }, options.teacherExitGraceMs)
    teacherExitTimer.unref()
  }
  app.addHook('preClose', async () => { shuttingDown = true; clearTimeout(teacherExitTimer) })
  const joinStudent = async (joinCode:string,name:string,resumeToken?:string) => {
    const result=await service.join(joinCode,name,resumeToken)
    if(!resumeToken)for(const [socket,id] of students)if(id===result.participantId){socket.send(JSON.stringify({type:'student-replaced'}));socket.close(1008,'Student reconnected elsewhere')}
    notify();return result
  }
  const owner = async (request: FastifyRequest) => {
    const { sessionId } = sessionParams.parse(request.params)
    const secret = request.headers['x-teacher-token']
    if (!(await teacherAuth.authenticated(request))) await service.teacher(sessionId, typeof secret === 'string' ? secret : undefined)
    else await db.session.findUniqueOrThrow({where:{id:sessionId}})
    return sessionId
  }
  const deviceHub=registerDeviceHub(app,db,service,owner,notify,options.now)
  const provisioning=new DeviceProvisioning()
  const localDeviceTesting=options.enableLocalDeviceTesting===true
  if(localDeviceTesting)app.addHook('onReady',async()=>{await provisioning.start(options.deviceProvisioningPort??0)})
  app.addHook('onClose',async()=>provisioning.close())
  const netsbloxDevices=registerNetsBloxDevices(app,db,deviceHub,owner,notify,service,options.netsbloxDevices,localDeviceTesting?provisioning:undefined)
  let resolvingWarnings: Promise<void> | undefined
  const warningTimer = setInterval(() => {
    if (resolvingWarnings) return
    resolvingWarnings = service.resolveWarningDismissals().then(count => { if (count) notify() })
      .catch(error => app.log.error(error)).finally(() => { resolvingWarnings = undefined })
  }, 1000)
  warningTimer.unref()
  app.addHook('onClose', async () => { clearInterval(warningTimer); await resolvingWarnings })

  app.get('/api/health', async () => { await db.$queryRaw`SELECT 1`; return { ok: true } })
  app.get('/api/state', async request => {
    const { sessionId } = z.object({ sessionId: uuid.optional() }).parse(request.query)
    const account = await teacherAuth.currentAccount(request)
    if (sessionId && !account) await service.teacher(sessionId, request.headers['x-teacher-token'] as string | undefined)
    return service.state(sessionId, !!account || !!sessionId, account?.id)
  })
  app.get('/api/sessions', async request => {
    if (!(await teacherAuth.authenticated(request))) throw new ApiError(401, 'Sign in to the teacher dashboard.')
    return (await db.session.findMany({orderBy:{createdAt:'desc'}})).map(session=>service.sessionDto(session))
  })
  app.post('/api/sessions', async request => changed(service.createSession(z.object({ name }).parse(request.body).name)))
  app.delete('/api/sessions/:sessionId', async request => {
    const sessionId = await owner(request)
    await service.deleteSession(sessionId)
    for (const socket of subscribers) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'session-deleted', sessionId }))
    return { ok: true }
  })
  app.delete('/api/sessions/:sessionId/participants/:participantId',async request=>{
    const sessionId=await owner(request)
    const {participantId}=z.object({participantId:uuid}).parse(request.params)
    await service.removeStudent(sessionId,participantId)
    for(const [socket,id] of students)if(id===participantId){socket.send(JSON.stringify({type:'student-removed'}));socket.close(1008,'Removed by teacher')}
    notify();return {ok:true}
  })
  app.patch('/api/sessions/:sessionId', async request => {
    const id = await owner(request)
    const { status } = z.object({ status: z.enum(['open','closed']) }).parse(request.body)
    return changed(service.setSessionStatus(id, status === 'open' ? 'OPEN' : 'CLOSED'))
  })
  const joinSchema = z.object({ joinCode: z.string().trim().min(1).max(12), name, token: z.string().min(32).max(128).optional() })
  app.post('/api/participants/join', async request => {
    const data = joinSchema.parse(request.body)
    return joinStudent(data.joinCode, data.name, data.token)
  })
  app.post('/api/participants/heartbeat',async request=>{
    const {token,visibility}=z.object({token:z.string().min(32).max(128),visibility:z.enum(['visible','hidden']).optional()}).parse(request.body)
    return changed(service.heartbeat(token,visibility))
  })
  const studentToken = (request: { headers: Record<string, unknown> }) => {
    const auth = request.headers.authorization
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new ApiError(401, 'A student token is required.')
    return z.string().min(32).max(128).parse(auth.slice(7))
  }
  app.get('/api/student/state', async request => service.studentState(studentToken(request)))
  app.post('/api/student/activities/finish', async request => {
    const { progressId } = z.object({ progressId: uuid }).parse(request.body)
    return changed(service.finishStudentActivity(studentToken(request), progressId))
  })
  app.post('/api/student/leave', async request => changed(service.leaveStudent(studentToken(request))))
  app.post('/api/student/messages', async request => {
    const message = await service.groupMessage(studentToken(request), z.object({ text: z.string().trim().min(1).max(1000) }).parse(request.body).text)
    const recipients = new Set(message.recipients)
    // membership gets checked again so moved students dont receive their old group messages
    const current = await db.groupMember.findMany({ where: { groupId: message.groupId, participantId: { in: message.recipients } } })
    const allowed = new Set(current.map(m => m.participantId))
    if (!allowed.has(message.senderId)) throw new ApiError(409, 'Your group changed. Try sending again.')
    for (const [socket, participantId] of students) if (socket.readyState === 1 && recipients.has(participantId) && allowed.has(participantId)) {
      const { recipients: _recipients, ...chat } = message
      socket.send(JSON.stringify(chat))
    }
    return changed(Promise.resolve({ ok: true }))
  })
  app.post('/api/student/help', async request => changed(service.requestHelp(studentToken(request), z.object({ text: z.string().trim().min(1).max(1000) }).parse(request.body).text)))
  app.post('/api/sessions/:sessionId/groups/:groupId/messages', async request => {
    const sessionId = await owner(request)
    const { groupId } = z.object({ groupId: uuid }).parse(request.params)
    const { text } = z.object({ text: z.string().trim().min(1).max(1000) }).parse(request.body)
    const account = await teacherAuth.currentAccount(request)
    return changed(service.teacherMessage(sessionId, groupId, account?.name ?? 'Teacher', text))
  })
  app.post('/api/sessions/:sessionId/groups/:groupId/help/:id/resolve', async request => {
    const sessionId = await owner(request)
    const { groupId, id } = z.object({ groupId: uuid, id: uuid }).parse(request.params)
    return changed(service.resolveHelp(sessionId, groupId, id))
  })
  app.put('/api/activities/:id', async request => {
    const a = activitySchema.parse(request.body)
    const teacher = await teacherAuth.authenticated(request)
    if (a.testConfig) {
      if (!teacher) throw new ApiError(401, 'Sign in as a teacher to save tests.')
      try { parseActivityTests(a.testConfig) }
      catch (error) { throw new ApiError(400, (error as Error).message) }
    }
    if (uuid.parse((request.params as { id: string }).id) !== a.id) throw new ApiError(400, 'Activity IDs do not match.')
    return changed(service.saveActivity(a, !!teacher))
  })
  app.put('/api/playlists/:id', async request => {
    const p = playlistSchema.parse(request.body)
    if (uuid.parse((request.params as { id: string }).id) !== p.id) throw new ApiError(400, 'Playlist IDs do not match.')
    return changed(service.savePlaylist(p))
  })
  app.delete('/api/activities/:id', async request => changed(service.deleteLibrary('activity', uuid.parse((request.params as { id: string }).id))))
  app.delete('/api/playlists/:id', async request => changed(service.deleteLibrary('playlist', uuid.parse((request.params as { id: string }).id))))
  app.post('/api/sessions/:sessionId/groups', async request => changed(service.createGroup(await owner(request), z.object({ name }).parse(request.body).name)))
  app.delete('/api/sessions/:sessionId/groups',async request=>changed(service.deleteGroups(await owner(request),z.object({groupIds:ids}).parse(request.body).groupIds)))
  app.delete('/api/sessions/:sessionId/groups/:id', async request => changed(service.deleteGroup(await owner(request), uuid.parse((request.params as { id: string }).id))))
  app.post('/api/sessions/:sessionId/memberships', async request => {
    const sessionId = await owner(request)
    const { groupId, participantIds } = z.object({ groupId: uuid, participantIds: ids }).parse(request.body)
    return changed(service.moveStudents(sessionId, groupId, participantIds))
  })
  app.post('/api/sessions/:sessionId/memberships/auto',async request=>{
    const sessionId=await owner(request)
    const {participantIds}=z.object({participantIds:z.array(uuid).min(1).max(1000).refine(a=>new Set(a).size===a.length,'IDs must be unique')}).parse(request.body)
    return changed(service.autoGroupStudents(sessionId,participantIds))
  })
  app.delete('/api/sessions/:sessionId/memberships',async request=>{
    const sessionId=await owner(request)
    const {participantIds}=z.object({participantIds:ids}).parse(request.body)
    return changed(service.unassignStudents(sessionId,participantIds))
  })
  app.post('/api/sessions/:sessionId/assignments', async request => {
    const sessionId = await owner(request)
    const data = work.extend({ groupIds: ids }).parse(request.body)
    return changed(service.assignWork(sessionId, data.groupIds, data.kind, data.id))
  })
  app.delete('/api/sessions/:sessionId/groups/:groupId/assignments', async request => {
    const sessionId = await owner(request)
    const { groupId } = z.object({ groupId: uuid }).parse(request.params)
    const data = work.parse(request.body)
    return changed(service.removeWork(sessionId, groupId, data.kind, data.id))
  })
  app.post('/api/sessions/:sessionId/groups/:groupId/activity-review', async request => {
    const sessionId = await owner(request)
    const { groupId } = z.object({ groupId: uuid }).parse(request.params)
    const { progressId, decision, message } = z.object({ progressId: uuid, decision: z.enum(['complete', 'return']), message: z.string().trim().max(2000).optional() }).parse(request.body)
    return changed(service.reviewActivity(sessionId, groupId, progressId, decision, message))
  })
  const testPath = '/api/sessions/:sessionId/groups/:groupId/activity-tests/:progressId'
  app.get(testPath, async request => {
    const sessionId = await owner(request)
    const { groupId, progressId } = z.object({ groupId: uuid, progressId: uuid }).parse(request.params)
    return service.activityTestProject(sessionId, groupId, progressId)
  })
  app.post(testPath, async request => {
    const sessionId = await owner(request)
    const { groupId, progressId } = z.object({ groupId: uuid, progressId: uuid }).parse(request.params)
    const { fingerprint, outputs } = z.object({
      fingerprint: z.string().length(64),
      outputs: z.array(z.union([
        z.object({ actual: z.custom<import('../src/types.js').TestValue>(value => isTestValue(value)) }),
        z.object({ error: z.string().max(400) }),
      ])).max(20),
    }).parse(request.body)
    return changed(service.recordActivityTests(sessionId, groupId, progressId, fingerprint, outputs))
  })
  app.get('/api/sessions/:sessionId/groups/:groupId/editor',async request=>{
    const sessionId=await owner(request)
    const {groupId}=z.object({groupId:uuid}).parse(request.params)
    const {after,revision}=z.object({after:z.coerce.number().int().min(-1).default(-1),revision:uuid.optional()}).parse(request.query)
    return viewGroupEditor(db,service,sessionId,groupId,after,revision)
  })
  app.post('/api/sessions/:sessionId/groups/:groupId/editor/reset',async request=>{
    const sessionId=await owner(request)
    const {groupId}=z.object({groupId:uuid}).parse(request.params)
    return changed(resetGroupEditor(db,service,sessionId,groupId))
  })
  app.post('/api/sessions/:sessionId/devices', async request => {
    const sessionId = await owner(request)
    const data = z.object({ name, type: name, capabilities: z.array(name).min(1).max(20).refine(a => new Set(a).size === a.length, 'Capabilities must be unique'), status: z.enum(['ONLINE','OFFLINE','DEGRADED']).default('ONLINE') }).parse(request.body)
    return changed(service.registerDevice(sessionId, data))
  })
  app.delete('/api/sessions/:sessionId/device-assignments',async request=>{
    const sessionId=await owner(request),{deviceIds}=z.object({deviceIds:ids}).parse(request.body)
    const devices=await db.sessionDevice.findMany({where:{sessionId,id:{in:deviceIds}},include:{runtime:true}})
    if(devices.length!==deviceIds.length)throw new ApiError(404,'Select devices from this classroom.')
    for(const device of devices)if(device.runtime&&await db.deviceControl.findFirst({where:{sessionDeviceId:device.id}}))await netsbloxDevices.controls.forceRelease(sessionId,device.id)
    return changed(service.unassignDevices(sessionId,deviceIds))
  })
  app.post('/api/sessions/:sessionId/device-assignments/auto',async request=>{
    const sessionId=await owner(request)
    const {deviceIds}=z.object({deviceIds:ids}).parse(request.body)
    return changed(service.autoAssignDevices(sessionId,deviceIds))
  })
  app.post('/api/sessions/:sessionId/warning-dismissals', async request => {
    const sessionId = await owner(request)
    const account = await teacherAuth.currentAccount(request)
    if (!account) throw new ApiError(401, 'Sign in to dismiss a notice or warning.')
    const { fingerprint } = z.object({
      fingerprint: z.string().min(1).max(1500).refine(value => {
        try {
          const parts = JSON.parse(value)
          return Array.isArray(parts) && parts.length === 4 && typeof parts[0] === 'string'
            && ['warning', 'notice'].includes(parts[1]) && typeof parts[2] === 'string'
            && (parts[3] === null || typeof parts[3] === 'string')
        } catch { return false }
      }, 'Only notices and warnings can be dismissed.'),
    }).parse(request.body)
    await db.warningDismissal.upsert({
      where: { accountId_sessionId_fingerprint: { accountId: account.id, sessionId, fingerprint } },
      create: { accountId: account.id, sessionId, fingerprint }, update: { createdAt: new Date() },
    })
    notify()
    return { ok: true }
  })
  app.post('/api/sessions/:sessionId/device-assignments/replacement', async request => {
    const sessionId = await owner(request)
    const data = z.object({ groupId: uuid, failedDeviceId: uuid, replacementDeviceId: uuid, sourceGroupId: uuid.nullable().default(null), failureKey: z.string().min(1).max(300), decision: z.enum(['approve', 'reject']) }).parse(request.body)
    await changed(service.reviewDeviceReplacement(sessionId, data.groupId, data.failedDeviceId, data.replacementDeviceId, data.sourceGroupId, data.failureKey, data.decision))
    if(data.decision==='approve'){
      try{return {identification:await netsbloxDevices.identify(sessionId,data.replacementDeviceId)}}catch(e){return {identificationError:e instanceof Error?e.message:'Identification could not start.'}}
    }
    return {ok:true}
  })
  app.post('/api/sessions/:sessionId/device-assignments', async request => {
    const sessionId = await owner(request)
    const { groupId, deviceIds } = z.object({ groupId: uuid, deviceIds: ids }).parse(request.body)
    return changed(service.assignDevices(sessionId, groupId, deviceIds))
  })
  app.get('/api/live', { websocket: true }, (socket, request) => {
    const timeout = setTimeout(() => socket.close(1008, 'Subscribe first'), 5000)
    socket.once('message', async raw => {
      try {
        const data = z.object({ sessionId: uuid.optional(), teacherToken: z.string().optional(), studentToken: z.string().min(32).max(128).optional(), teacher: z.boolean().optional() }).parse(JSON.parse(raw.toString()))
        if (data.studentToken) {
          if (data.sessionId || data.teacherToken || data.teacher) throw new ApiError(400, 'Choose a student or teacher subscription.')
          const p = await service.student(data.studentToken)
          students.set(socket, p.id)
          studentTokens.set(socket,data.studentToken)
          pongTimes.set(socket,Date.now())
        } else if (data.teacher) {
          const account = await teacherAuth.currentAccount(request)
          if (!account) throw new ApiError(401, 'Teacher sign-in required.')
          if (socket.readyState !== 1) return
          clearTimeout(teacherExitTimer)
          teacherSockets.set(socket, account.id)
          pongTimes.set(socket, Date.now())
        } else if (data.sessionId) await service.teacher(data.sessionId, data.teacherToken)
        clearTimeout(timeout)
        if (socket.readyState !== 1) return
        subscribers.add(socket)
        socket.send(JSON.stringify({ type: 'ready' }))
      } catch { socket.close(1008, 'Session subscription rejected') }
    })
    socket.on('pong',()=>{
      if (teacherSockets.has(socket)) pongTimes.set(socket, Date.now())
      const secret=studentTokens.get(socket)
      if(!secret)return
      pongTimes.set(socket,Date.now())
      void service.touchPresence(secret).catch(error=>app.log.error(error))
    })
    socket.on('close', () => { teacherDisconnected(socket); clearTimeout(timeout); subscribers.delete(socket); students.delete(socket);studentTokens.delete(socket);pongTimes.delete(socket) })
    socket.on('error', () => { teacherDisconnected(socket); subscribers.delete(socket); students.delete(socket);studentTokens.delete(socket);pongTimes.delete(socket) })
  })
  const pingTimer=setInterval(()=>{
    for(const socket of new Set([...studentTokens.keys(), ...teacherSockets.keys()])){
      if(socket.readyState!==1)continue
      if(Date.now()-(pongTimes.get(socket)??0)>Math.max(15000,service.timeoutMs)){socket.terminate();continue}
      socket.ping()
    }
  },Math.min(5000,Math.floor(service.timeoutMs/3)))
  pingTimer.unref()
  let sweeping = false
  const timer = setInterval(async () => {
    if (sweeping) return
    sweeping = true
    try { if (await service.expirePresence()) notify() } catch (error) { app.log.error(error) } finally { sweeping = false }
  }, options.presenceIntervalMs ?? 1000)
  timer.unref()
  app.addHook('onClose', async () => { clearInterval(timer);clearInterval(pingTimer); for (const socket of subscribers) socket.close(1001) })
  const arg = (name: string, optional = false) => ({ name, optional, type: { name: 'String', params: [] }, description: name, tags: [] })
  app.get('/rpc/', async () => [{ name: 'Classroom', categories: [['Education']] }])
  app.get('/rpc/Classroom', async () => ({ name: 'Classroom', description: 'Join a classroom and send presence heartbeats.', rpcs: {
    joinSession: { args: [arg('joinCode'), arg('name'), arg('resumeToken', true)], returns: { type: { name: 'String', params: [] } }, deprecated: false, categories: [[]] },
    heartbeat: { args: [arg('token')], returns: { type: { name: 'String', params: [] } }, deprecated: false, categories: [[]] },
  } }))
  app.post('/rpc/Classroom/joinSession', async request => {
    const data = z.object({ joinCode: z.string(), name, resumeToken: z.string().optional() }).parse(request.body)
    const joined = await joinStudent(data.joinCode.trim(), data.name, data.resumeToken || undefined)
    return joined.token
  })
  app.post('/rpc/Classroom/heartbeat', async request => {
    const data = z.object({ token: z.string().min(32).max(128) }).parse(request.body)
    await changed(service.heartbeat(data.token))
    return 'online'
  })
  return { app, service, deviceHub, netsbloxDevices, provisioning }
}
