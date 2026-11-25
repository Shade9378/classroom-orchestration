import { planDeviceReplacements, rejectionPrefix } from '../src/state/deviceReplacements.js'
import { getClassroomAlerts, alertFingerprint, canDismissAlert } from '../src/state/classroomAlerts.js'
import {combineHardwareRequirements} from '../src/state/hardware.js'
import {planDeviceAssignments} from './autoDevices.js'
import {deviceControlKey} from '../src/devices/control.js'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { Prisma, PrismaClient, type CompletionMethod, type ProgressStatus, type GroupChatMessage } from '@prisma/client'
import { parseActivityTests } from '../src/state/activityTests.js'
import { starterProject } from '../src/student/starter.js'
import type { Activity, ActivityTestConfig, Playlist, TestValue, Device, Group } from '../src/types.js'

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) { super(message) }
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const completionMethods: Record<Activity['completionMethod'], CompletionMethod> = {
  student: 'STUDENT', teacher: 'TEACHER', project: 'PROJECT',
}
export const activeProgressStatuses: ProgressStatus[] = ['IN_PROGRESS', 'SUBMITTED']
const chatDto = (message: GroupChatMessage) => ({ ...message, type: 'group-message' as const, createdAt: message.createdAt.toISOString(), resolvedAt: message.resolvedAt?.toISOString() ?? null })
const normalizedDismissal = (fingerprint: string) => {
  try {
    const parts = JSON.parse(fingerprint)
    if (Array.isArray(parts) && typeof parts[0] === 'string' && parts[0].startsWith('review-') && parts[1] === 'warning') {
      parts[1] = 'notice'
      return JSON.stringify(parts)
    }
  } catch {}
  return fingerprint
}
const token = () => randomBytes(32).toString('hex')
type Tx = Prisma.TransactionClient
export class ClassroomService {
  constructor(public db: PrismaClient, public timeoutMs = 15000, public now = () => new Date(), public awayTimeoutMs = Math.max(timeoutMs,120000)) {}
  async transaction<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 }) }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 5) throw error
        await new Promise(resolve => setTimeout(resolve, Math.min(160, 10 * 2 ** attempt) + randomInt(0, 10)))
      }
    }
  }
  async assertNameAvailable(tx: Tx, kind: 'Session'|'Activity'|'Playlist', name: string, id?: string) {
    const matches = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM ${Prisma.raw('"' + kind + '"')}
      WHERE lower(btrim(name)) = lower(btrim(${name}))
      AND (${id ?? null}::uuid IS NULL OR id <> ${id ?? null}::uuid) LIMIT 1
    `)
    if (matches.length && kind === 'Session') {
      const existing = await tx.session.findUniqueOrThrow({ where: { id: matches[0].id } })
      throw new ApiError(409, `A session named "${existing.name}" already exists in the database (${existing.status.toLowerCase()}). Closed sessions also keep their names reserved. Select it from the session dropdown, or choose a different name.`)
    }
    if (matches.length) throw new ApiError(409, `${kind === 'Activity' ? 'An' : 'A'} ${kind.toLowerCase()} named "${name.trim()}" already exists. Choose a different name.`)
  }
  async namedWrite<T>(kind: 'Session'|'Activity'|'Playlist', name: string, id: string | undefined, action: (tx: Tx) => Promise<T>) {
    try {
      return await this.transaction(async tx => { await this.assertNameAvailable(tx, kind, name, id); return action(tx) })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') await this.assertNameAvailable(this.db, kind, name, id)
      throw error
    }
  }
  async teacher(sessionId: string, secret?: string) {
    const session = await this.db.session.findUnique({ where: { id: sessionId } })
    if (!session || !secret || session.teacherTokenHash !== hashToken(secret)) throw new ApiError(403, 'This session is not available with the current teacher token.')
    return session
  }
  async createSession(name: string) {
    const teacherToken = token()
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
      try {
        const session = await this.namedWrite('Session', name, undefined, tx => tx.session.create({ data: { name: name.trim(), joinCode, teacherTokenHash: hashToken(teacherToken) } }))
        return { session: this.sessionDto(session), teacherToken }
      } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; throw error }
    }
    throw new ApiError(503, 'Could not allocate a join code. Please try again.')
  }
  sessionDto(s: { id: string; name: string; joinCode: string; status: string; createdAt: Date }) {
    return { id: s.id, name: s.name, joinCode: s.joinCode, status: s.status.toLowerCase(), createdAt: s.createdAt.toISOString() }
  }
  async deleteSession(sessionId: string) {
    await this.transaction(async tx => {
      await tx.session.delete({ where: { id: sessionId } })
    })
  }
  async setSessionStatus(sessionId: string, status: 'OPEN' | 'CLOSED') {
    return this.transaction(async tx => {
      if(status==='OPEN'){
        const saved=await tx.deviceRuntime.findMany({where:{device:{sessionId},state:{not:'paused'}},include:{device:{include:{device:true}}}})
        const key=(row:typeof saved[number])=>'device-connection:'+(row.mode==='bluetooth'?row.bluetoothId:deviceControlKey(row))
        for(const row of saved.sort((a,b)=>key(a).localeCompare(key(b)))){
          if(!['bluetooth','roboscape','iotscape','phoneiot'].includes(row.mode)||(row.mode==='bluetooth'?!row.bluetoothId:!row.remoteDeviceId||!row.serviceName))continue
          const sourceKey=key(row)
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${sourceKey},0))`
          const identity:Prisma.DeviceRuntimeWhereInput=row.mode==='bluetooth'?{mode:row.mode,bluetoothId:row.bluetoothId}:{mode:row.mode,serviceName:row.serviceName,remoteDeviceId:row.mode==='iotscape'?row.remoteDeviceId:{equals:row.remoteDeviceId,mode:'insensitive'}}
          const other=await tx.deviceRuntime.findFirst({where:{...identity,state:{not:'paused'},device:{sessionId:{not:sessionId},session:{status:'OPEN'}}},include:{device:{include:{session:true}}}})
          if(!other)continue
          await tx.deviceRuntime.update({where:{sessionDeviceId:row.sessionDeviceId},data:{state:'paused'}})
          await tx.sessionDevice.update({where:{id:row.sessionDeviceId},data:{status:'OFFLINE'}})
          const assignments=await tx.deviceAssignment.findMany({where:{sessionDeviceId:row.sessionDeviceId,status:'ACTIVE'}})
          await tx.systemEvent.createMany({data:assignments.map(a=>({sessionId,groupId:a.groupId,sessionDeviceId:row.sessionDeviceId,type:'DEVICE_CONNECTION_PAUSED',message:row.device.device.name+' ('+row.device.device.type+'): connection paused because this device is connected in '+other.device.session.name+'. Disconnect it there before reconnecting here.'}))})
        }
      }
      const s = await tx.session.update({ where: { id: sessionId }, data: { status } })
      if (status === 'CLOSED'){
        await tx.participant.updateMany({ where: { sessionId }, data: { status: 'OFFLINE' } })
        await tx.sessionDevice.updateMany({where:{sessionId},data:{status:'OFFLINE'}})
      }
      const groups=await tx.group.findMany({where:{sessionId},select:{id:true}})
      await tx.systemEvent.createMany({data:groups.map(g=>({sessionId,groupId:g.id,type:'SESSION_STATUS',message:`Session ${status.toLowerCase()}.`}))})
      return this.sessionDto(s)
    })
  }
  async closeOpenSessions(reason: string) {
    return this.transaction(async tx => {
      const sessions = await tx.session.findMany({ where: { status: 'OPEN' }, include: { groups: { select: { id: true } } } })
      if (!sessions.length) return 0
      const ids = sessions.map(session => session.id)
      await tx.session.updateMany({ where: { id: { in: ids } }, data: { status: 'CLOSED' } })
      await tx.participant.updateMany({ where: { sessionId: { in: ids } }, data: { status: 'OFFLINE' } })
      await tx.sessionDevice.updateMany({where:{sessionId:{in:ids}},data:{status:'OFFLINE'}})
      await tx.systemEvent.createMany({ data: sessions.flatMap(session => session.groups.map(group => ({ sessionId: session.id, groupId: group.id, type: 'SESSION_STATUS', message: reason }))) })
      return sessions.length
    })
  }
  async join(joinCode: string, name: string, resumeToken?: string) {
    const participantToken = resumeToken ?? token()
    try {
      return await this.transaction(async tx => {
        const session = await tx.session.findUnique({ where: { joinCode: joinCode.trim().toUpperCase() } })
        if (!session || session.status !== 'OPEN') throw new ApiError(400, 'Join code is invalid or the classroom session is closed.')
        let existing = resumeToken ? await tx.participant.findUnique({ where: { tokenHash: hashToken(resumeToken) },include:{session:true,member:true} }) : null
        if (resumeToken && (!existing || existing.sessionId !== session.id)) throw new ApiError(401, 'The participant token is invalid for this session.')
        if (!resumeToken) {
          const matches=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT id FROM "Participant" WHERE lower(btrim(name))=lower(btrim(${name})) LIMIT 1`)
          existing=matches.length?await tx.participant.findUniqueOrThrow({where:{id:matches[0].id},include:{session:true,member:true}}):null
          if(existing && existing.status!=='OFFLINE' && existing.session.status==='OPEN' && existing.lastSeenAt.getTime()>=this.now().getTime()-(existing.status==='AWAY'?this.awayTimeoutMs:this.timeoutMs))throw new ApiError(409,'This student name is already online. Use a different name or wait until that student disconnects.')
        }
        if(existing && existing.sessionId!==session.id) {
          await tx.groupMember.deleteMany({where:{participantId:existing.id}})
          if(existing.member)await tx.systemEvent.create({data:{sessionId:existing.sessionId,groupId:existing.member.groupId,type:'PARTICIPANT_LEFT',message:`${existing.name} moved to another classroom session.`}})
        }
        const participant=existing
          ? await tx.participant.update({where:{id:existing.id},data:{sessionId:session.id,lastSeenAt:this.now(),status:'ONLINE',tokenHash:hashToken(participantToken)}})
          : await tx.participant.create({data:{sessionId:session.id,name:name.trim(),tokenHash:hashToken(participantToken),lastSeenAt:this.now()}})
        if(existing?.member && existing.sessionId===session.id)await tx.systemEvent.create({data:{sessionId:session.id,groupId:existing.member.groupId,type:existing?'PARTICIPANT_RECONNECTED':'PARTICIPANT_JOINED',message:`${participant.name} ${existing?'reconnected':'joined'}.`}})
        return {participantId:participant.id,sessionId:session.id,name:participant.name,token:participantToken,heartbeatIntervalMs:Math.min(5000,Math.floor(this.timeoutMs/3)),heartbeatTimeoutMs:this.timeoutMs}
      })
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ApiError(409,'This student name is already in use. Try again or choose a different name.')
      throw error
    }
  }
  async removeStudent(sessionId:string,participantId:string) {
    await this.transaction(async tx=>{
      const participant=await tx.participant.findFirst({where:{id:participantId,sessionId},include:{member:true}})
      if(!participant)throw new ApiError(404,'This student is not in the selected session.')
      await tx.participant.delete({where:{id:participant.id}})
      if(participant.member){await tx.systemEvent.create({data:{sessionId,groupId:participant.member.groupId,type:'PARTICIPANT_REMOVED',message:`${participant.name} was removed from the session by the teacher.`}});await this.reconcileCompletionVotes(tx,participant.member.groupId)}
    })
  }
  async heartbeat(secret: string, visibility?:'visible'|'hidden') {
    return this.transaction(async tx => {
      const p = await tx.participant.findUnique({ where: { tokenHash: hashToken(secret) }, include: { session: true, member: true } })
      if (!p) throw new ApiError(401, 'Participant token is invalid.')
      if (p.session.status !== 'OPEN') throw new ApiError(409, 'This classroom session is closed.')
      const status=visibility==='hidden'?'AWAY':visibility==='visible'?'ONLINE':p.status==='AWAY'?'AWAY':'ONLINE'
      await tx.participant.update({ where: { id: p.id }, data: { status, lastSeenAt: this.now() } })
      if(p.status!==status && p.member)await tx.systemEvent.create({data:{sessionId:p.sessionId,groupId:p.member.groupId,type:status==='AWAY'?'PARTICIPANT_AWAY':'PARTICIPANT_ONLINE',message:`${p.name} is ${status==='AWAY'?'away':'online'}.`}})
      return { participantId: p.id, sessionId: p.sessionId, groupId: p.member?.groupId, status:status.toLowerCase() }
    })
  }
  async touchPresence(secret:string) {
    // native pongs keeps background tabs alive without reviving students who left
    await this.db.participant.updateMany({where:{tokenHash:hashToken(secret),status:{in:['ONLINE','AWAY']},session:{status:'OPEN'}},data:{lastSeenAt:this.now()}})
  }
  async student(secret: string, tx: Tx = this.db) {
    const participant = await tx.participant.findUnique({ where: { tokenHash: hashToken(secret) }, include: { session: true, member: true } })
    if (!participant) throw new ApiError(401, 'Your student connection is no longer available. Join the class again.')
    return participant
  }
  async deviceControls(devices:{runtime:{mode:string;serviceName:string|null;remoteDeviceId:string|null}|null}[],sessionId:string,tx:Tx=this.db){
    const leases=await tx.deviceControl.findMany({where:{sourceKey:{in:devices.flatMap(d=>d.runtime?[deviceControlKey(d.runtime)]:[])}}})
    const owners=await tx.participant.findMany({where:{id:{in:leases.map(l=>l.participantId)}}})
    return new Map(leases.map(l=>{const p=owners.find(p=>p.id===l.participantId);return [l.sourceKey,{participantId:p?.sessionId===sessionId?p.id:null,name:p?.sessionId===sessionId?p.name:'Another student',expiresAt:l.expiresAt.toISOString()}]}))
  }
  async studentState(secret: string) {
    return this.db.$transaction(async tx => {
      const p = await this.student(secret, tx)
      const group = p.member ? await tx.group.findUnique({ where: { id: p.member.groupId }, include: {
        members: { include: { participant: true } },
        devices: { where: { status: 'ACTIVE' }, include: { sessionDevice: { include: { device: true, runtime: true } } } },
        assignments: { orderBy: { assignedAt: 'asc' }, include: { activity: true, playlist: { include: { items: { orderBy: { position: 'asc' }, include: { activity: true } } } }, progress: { include: { votes: true } } } },
        messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 },
      } }) : null
      const active = group?.assignments.flatMap(a => a.progress).find(progress => activeProgressStatuses.includes(progress.status))
      const current = active ? await tx.activity.findUnique({ where: { id: active.activityId } }) : null
      const pendingHelp = group ? await tx.groupChatMessage.findFirst({ where: { groupId: group.id, kind: 'help', resolvedAt: null } }) : null
      const assigned=group?.devices.map(a=>a.sessionDevice)??[]
      const controls=await this.deviceControls(assigned,p.sessionId,tx)
      const catalog=await tx.deviceRuntime.findMany({where:{device:{sessionId:p.sessionId},serviceName:{not:null}},select:{serviceName:true}})
      return {
        session: this.sessionDto(p.session), participant: { id: p.id, name: p.name },
        devices: group?.devices.flatMap(a=>a.sessionDevice.runtime?.serviceName&&a.sessionDevice.runtime.remoteDeviceId?[{id:a.sessionDevice.id,name:a.sessionDevice.device.name,control:controls.get(deviceControlKey(a.sessionDevice.runtime)),service:a.sessionDevice.runtime.serviceName,deviceId:a.sessionDevice.runtime.remoteDeviceId,status:a.sessionDevice.status.toLowerCase()}]:[])??[],
        managedDeviceServices:[...new Set(catalog.map(r=>r.serviceName!))],
        heartbeatIntervalMs: Math.min(5000, Math.floor(this.timeoutMs / 3)),
        group: group ? { id: group.id, name: group.name, members: group.members.map(m => ({ id: m.participant.id, name: m.participant.name, status: m.participant.status.toLowerCase() })),
          assignments: group.assignments.map(a => ({ id: a.id, kind: a.activityId ? 'activity' : 'playlist', name: a.activity?.name ?? a.playlist?.name ?? '', activities: a.activity ? [{ id: a.activity.id, name: a.activity.name }] : a.playlist?.items.map(i => ({ id: i.activity.id, name: i.activity.name })) ?? [] })) } : null,
        messages: group?.messages.slice().reverse().map(chatDto) ?? [],
        helpPending: !!pendingHelp,
        finishedAssignedWork: !!group?.assignments.some(a => a.progress.length) && group.assignments.every(a => a.progress.every(p => p.status === 'COMPLETED')),
        activity: current && active ? {
          id: current.id, name: current.name, description: current.description, starterProject: current.starterProjectRef,
          progressId: active.id, awaitingReview: active.status === 'SUBMITTED', completionMethod: current.completionMethod.toLowerCase(),
          completionVote: current.completionMethod==='STUDENT'&&group?{agreed:active.votes.length,total:group.members.length,hasVoted:active.votes.some(v=>v.participantId===p.id),pendingNames:group.members.filter(m=>!active.votes.some(v=>v.participantId===m.participantId)).map(m=>m.participant.name)}:undefined,
          testing: current.completionMethod === 'PROJECT' && !!current.testConfig,
          testsFailed: active.status === 'SUBMITTED' && !!active.testResult,
        } : null,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  async leaveStudent(secret: string) {
    await this.transaction(async tx => {
      const p = await this.student(secret, tx)
      await tx.participant.update({ where: { id: p.id }, data: { status: 'OFFLINE', tokenHash: hashToken(token()) } })
      if(p.member)await tx.systemEvent.create({ data: { sessionId: p.sessionId, groupId:p.member.groupId, type: 'PARTICIPANT_LEFT', message: `${p.name} left the student workspace.` } })
    })
  }
  async groupMessage(secret: string, text: string) {
    return this.transaction(async tx => {
      const p = await this.student(secret, tx)
      if (p.session.status !== 'OPEN' || p.status === 'OFFLINE') throw new ApiError(409, 'Join an active classroom before sending a message.')
      if (!p.member) throw new ApiError(409, 'Your teacher must assign you to a group first.')
      const message = await tx.groupChatMessage.create({ data: { groupId: p.member.groupId, senderId: p.id, senderName: p.name, text } })
      const recipients = await tx.groupMember.findMany({ where: { groupId: p.member.groupId } })
      return { ...chatDto(message), recipients: recipients.map(m => m.participantId) }
    })
  }
  async teacherMessage(sessionId: string, groupId: string, senderName: string, text: string) {
    return this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } })
      if (session.status !== 'OPEN') throw new ApiError(409, 'Reopen the classroom before sending a message.')
      return chatDto(await tx.groupChatMessage.create({ data: { groupId, senderId: 'teacher', senderName: senderName === 'Teacher' ? 'Teacher' : senderName + ' (Teacher)', text } }))
    })
  }
  async requestHelp(secret: string, text: string) {
    return this.transaction(async tx => {
      const p = await this.student(secret, tx)
      if (p.session.status !== 'OPEN' || p.status === 'OFFLINE' || !p.member) throw new ApiError(409, 'Join an active classroom group before requesting help.')
      const groupId = p.member.groupId
      if (await tx.groupChatMessage.findFirst({ where: { groupId, kind: 'help', resolvedAt: null } })) throw new ApiError(409, 'Your group already has a pending help request.')
      const message = await tx.groupChatMessage.create({ data: { groupId, senderId: p.id, senderName: p.name, text, kind: 'help' } })
      await tx.systemEvent.create({ data: { sessionId: p.sessionId, groupId, type: 'GROUP_HELP_REQUESTED', message: p.name + ' requested help: ' + text } })
      return chatDto(message)
    })
  }
  async resolveHelp(sessionId: string, groupId: string, id: string) {
    return this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      const result = await tx.groupChatMessage.updateMany({ where: { id, groupId, kind: 'help', resolvedAt: null }, data: { resolvedAt: this.now() } })
      if (result.count) await tx.systemEvent.create({ data: { sessionId, groupId, type: 'GROUP_HELP_RESOLVED', message: 'Teacher resolved the group help request.' } })
      return { ok: true }
    })
  }
  async expirePresence() {
    return this.transaction(async tx => {
      const expired = await tx.participant.findMany({ where: { OR:[{status:'ONLINE',lastSeenAt:{lt:new Date(this.now().getTime()-this.timeoutMs)}},{status:'AWAY',lastSeenAt:{lt:new Date(this.now().getTime()-this.awayTimeoutMs)}}] },include:{member:true} })
      for (const p of expired) {
        await tx.participant.update({ where: { id: p.id }, data: { status: 'OFFLINE' } })
        if(p.member)await tx.systemEvent.create({ data: { sessionId: p.sessionId, groupId:p.member.groupId, type: 'PARTICIPANT_OFFLINE', message: `${p.name} stopped responding.` } })
      }
      return expired.length
    })
  }
  async library(includeTests = true) {
    const [activities, playlists] = await this.db.$transaction([
      this.db.activity.findMany({ include: { requirements: true }, orderBy: { createdAt: 'desc' } }),
      this.db.playlist.findMany({ include: { items: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
    ])
    return {
      activities: activities.map(a => ({ id: a.id, name: a.name, description: a.description, starterProject: a.starterProjectRef, starterProjectName:a.starterProjectName, requirements: a.requirements.map(r => ({ id: r.id, capability: r.capability, quantity: r.quantity })), completionMethod: a.completionMethod.toLowerCase(), estimatedMinutes: a.estimatedMinutes, category: a.category, ...(includeTests && a.testConfig ? { testConfig: a.testConfig } : {}) })),
      playlists: playlists.map(p => ({ id: p.id, name: p.name, description: p.description, activityIds: p.items.map(i => i.activityId) })),
    }
  }
  async state(sessionId?: string, includeTests = true, accountId?: string) {
    const observedAt = new Date()
    const library = await this.library(includeTests)
    if (!sessionId) return { ...library, session: null, students: [], groups: [], devices: [], events: [], dismissedWarningKeys: [] }
    const [session, students, groups, devices, events, dismissals, helpRequests, disconnects, replacementRejections] = await this.db.$transaction([
      this.db.session.findUniqueOrThrow({ where: { id: sessionId } }),
      this.db.participant.findMany({ where: { sessionId }, include: { member: true }, orderBy: { name: 'asc' } }),
      this.db.group.findMany({ where: { sessionId }, include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }, members: true, devices: { where: { status: 'ACTIVE' } }, assignments: { orderBy: { assignedAt: 'asc' }, include: { progress: { include: { votes:true, activity: { include: { requirements: true } } } } } } }, orderBy: { createdAt: 'asc' } }),
      this.db.sessionDevice.findMany({ where: { sessionId }, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }], include: { runtime:true, device: { include: { capabilities: true } }, assignments: { where: { status: 'ACTIVE' } } } }),
      this.db.systemEvent.findMany({ where: { sessionId, groupId:{not:null} }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.db.warningDismissal.findMany({ where: { sessionId }, select: { id: true, fingerprint: true, accountId: true, createdAt: true } }),
      this.db.groupChatMessage.findMany({ where: { group: { sessionId }, kind: 'help', resolvedAt: null } }),
      this.db.systemEvent.findMany({ where: { sessionId, type: 'DEVICE_OFFLINE', sessionDeviceId: { not: null } }, distinct: ['sessionDeviceId'], orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, sessionDeviceId: true } }),
      this.db.alert.findMany({ where: { group: { sessionId }, status: 'REJECTED', type: { startsWith: rejectionPrefix } }, select: { type: true } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    const controls=await this.deviceControls(devices,sessionId)
    const snapshot = {
      ...library, session: this.sessionDto(session),
      students: students.map(p => ({ id: p.id, name: p.name, status: p.status.toLowerCase(), groupId: p.member?.groupId, lastSeenAt: p.lastSeenAt.toISOString() })),
      groups: groups.map(g => {
        const active = g.assignments.flatMap(a => a.progress.map(p => ({ ...p, playlistId: a.playlistId }))).find(p => activeProgressStatuses.includes(p.status))
        return { messages: g.messages.slice().reverse().map(chatDto), helpRequests: helpRequests.filter(h => h.groupId === g.id).map(h => ({ id: h.id, senderName: h.senderName, text: h.text })), progress: g.assignments.flatMap(a => a.progress.map(p => ({ id: p.id, submissionId: p.submissionId, testResult: p.testResult, completionVotes:p.activity.completionMethod==='STUDENT'?p.votes.length:undefined,requiredVotes:p.activity.completionMethod==='STUDENT'?g.members.length:undefined, activityId: p.activityId, playlistId: a.playlistId, status: p.status.toLowerCase() }))), id: g.id, name: g.name, studentIds: g.members.map(m => m.participantId), deviceIds: g.devices.map(d => d.sessionDeviceId), assignedActivityIds: g.assignments.flatMap(a => a.activityId ? [a.activityId] : []), assignedPlaylistIds: g.assignments.flatMap(a => a.playlistId ? [a.playlistId] : []), activityId: active?.activityId, playlistId: active?.playlistId ?? undefined, status: g.status }
      }),
      devices: devices.map(d => ({ disconnectKey: (disconnects.find(event => event.sessionDeviceId === d.id)?.id ?? 'offline') + ':' + (d.assignments[0]?.id ?? 'unassigned'), id: d.id, name: d.device.name, control:d.runtime?controls.get(deviceControlKey(d.runtime)):undefined, type: d.device.type, capability: d.device.capabilities[0]?.capability ?? '', capabilities: d.device.capabilities.map(c => c.capability), status: d.status.toLowerCase(), assignedGroupId: d.assignments[0]?.groupId, batteryLevel: d.batteryLevel, latencyMs: d.latencyMs, runtime:d.runtime?{mode:d.runtime.mode,serviceName:d.runtime.serviceName,remoteDeviceId:d.runtime.remoteDeviceId,profile:d.runtime.profile,model:d.runtime.model,manufacturer:d.runtime.manufacturer,state:d.runtime.state,paired:d.runtime.paired,services:d.runtime.services,intervalMs:d.runtime.intervalMs,packetLoss:d.runtime.packetLoss,telemetry:d.runtime.telemetry,sampledAt:d.runtime.sampledAt?.toISOString()??null,controls:d.runtime.controls}:undefined })),
      events: events.map(e => ({ id: e.id, groupId: e.groupId, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
    }
    const replacements = session.status === 'OPEN' ? planDeviceReplacements(snapshot.groups as Group[], snapshot.activities as Activity[], snapshot.devices as Device[], new Set(replacementRejections.map(item => item.type.slice(rejectionPrefix.length)))) : []
    const currentSnapshot = { ...snapshot, groups: snapshot.groups.map(group => ({ ...group, replacements: replacements.filter(item => item.groupId === group.id) })) }
    const activeWarnings = new Set(getClassroomAlerts({
      activities: currentSnapshot.activities as Activity[], devices: currentSnapshot.devices as Device[], groups: currentSnapshot.groups as Group[],
      sessionOpen: session.status === 'OPEN',
      onReview: () => {},
    }).filter(canDismissAlert).map(alertFingerprint))
    const resolved = dismissals.filter(dismissal => !activeWarnings.has(normalizedDismissal(dismissal.fingerprint)) && dismissal.createdAt <= observedAt)
    if (resolved.length) await this.db.warningDismissal.deleteMany({
      where: { id: { in: resolved.map(dismissal => dismissal.id) }, createdAt: { lte: observedAt } },
    })
    return {
      ...currentSnapshot,
      dismissedWarningKeys: dismissals.filter(dismissal => dismissal.accountId === accountId && activeWarnings.has(normalizedDismissal(dismissal.fingerprint)))
        .map(dismissal => normalizedDismissal(dismissal.fingerprint)),
    }
  }
  async resolveWarningDismissals() {
    const dismissals = await this.db.warningDismissal.findMany({ select: { id: true, sessionId: true } })
    if (!dismissals.length) return 0
    for (const sessionId of new Set(dismissals.map(dismissal => dismissal.sessionId))) {
      try { await this.state(sessionId) }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) throw error
      }
    }
    const remaining = await this.db.warningDismissal.count({ where: { id: { in: dismissals.map(dismissal => dismissal.id) } } })
    return dismissals.length - remaining
  }
  async syncGroup(tx: Tx, groupId: string) {
    const assignments = await tx.groupAssignment.findMany({ where: { groupId }, orderBy: { assignedAt: 'asc' }, include: { playlist: { include: { items: { orderBy: { position: 'asc' } } } }, progress: true } })
    for (const a of assignments) {
      const items = a.activityId ? [{ activityId: a.activityId, id: null }] : a.playlist?.items ?? []
      await tx.groupActivityProgress.deleteMany({where:{assignmentId:a.id,activityId:{notIn:items.map(item=>item.activityId)}}})
      for (const item of items) {
        await tx.groupActivityProgress.upsert({ where: { assignmentId_activityId: { assignmentId: a.id, activityId: item.activityId } }, create: { assignmentId: a.id, activityId: item.activityId, playlistItemId: item.id }, update: {} })
      }
    }
    const progress = await tx.groupActivityProgress.findMany({ where: { assignment: { groupId } } })
    if (!progress.some(p => activeProgressStatuses.includes(p.status))) {
      let next: typeof progress[number] | undefined
      for (const a of assignments) {
        const ids = a.activityId ? [a.activityId] : a.playlist?.items.map(i => i.activityId) ?? []
        next = ids.map(id => progress.find(p => p.assignmentId === a.id && p.activityId === id && p.status === 'NOT_STARTED')).find(p => p)
        if (next) break
      }
      if (next) await tx.groupActivityProgress.update({ where: { id: next.id }, data: { status: 'IN_PROGRESS', startedAt: this.now() } })
    }
    const hasWork = progress.some(p => p.status !== 'COMPLETED')
    await tx.group.update({ where: { id: groupId }, data: { status: hasWork ? 'running' : 'idle' } })
  }
  private async updateActivityProgress(tx: Tx, sessionId: string, groupId: string, progressId: string, actor: string, decision: 'finish' | 'complete' | 'return', message = '') {
    const progress = await tx.groupActivityProgress.findFirst({
      where: { id: progressId, assignment: { groupId }, status: { in: activeProgressStatuses } },
      include: { activity: true },
    })
    if (!progress) throw new ApiError(409, 'This exercise is no longer current for the group.')
    if (decision === 'finish' && progress.status === 'SUBMITTED') return { ok: true }
    if (decision === 'return' && progress.status !== 'SUBMITTED') throw new ApiError(409, 'This exercise is no longer awaiting review.')

    if(decision==='return')await tx.groupCompletionVote.deleteMany({where:{progressId}})
    const status: ProgressStatus = decision === 'return' ? 'IN_PROGRESS'
      : decision === 'complete' || progress.activity.completionMethod === 'STUDENT' ? 'COMPLETED' : 'SUBMITTED'
    await tx.groupActivityProgress.update({
      where: { id: progressId },
      data: {
        status, completedAt: status === 'COMPLETED' ? this.now() : null,
        submissionId: status === 'SUBMITTED' ? randomUUID() : null,
        ...(status === 'COMPLETED' ? {} : { testResult: Prisma.DbNull }),
      },
    })
    if (message && decision !== 'finish') await tx.groupChatMessage.create({ data: {
      groupId, senderId: 'teacher', senderName: 'Teacher', kind: 'review', text: message,
      context: progress.activity.name + ' - ' + (decision === 'complete' ? 'Marked complete' : 'Returned for changes'),
    } })
    if (status === 'COMPLETED') await this.syncGroup(tx, groupId)
    const type = status === 'COMPLETED' ? 'ACTIVITY_COMPLETED' : status === 'SUBMITTED' ? 'ACTIVITY_SUBMITTED' : 'ACTIVITY_RETURNED'
    const verb = status === 'COMPLETED' ? ' completed ' : status === 'SUBMITTED' ? ' submitted ' : ' returned '
    const suffix = status === 'SUBMITTED' ? ' for review.' : status === 'IN_PROGRESS' ? ' for changes.' : '.'
    await tx.systemEvent.create({ data: { sessionId, groupId, type, message: actor + verb + progress.activity.name + suffix } })
    return { ok: true }
  }
  async finishStudentActivity(secret: string, progressId: string) {
    return this.transaction(async tx => {
      const participant = await this.student(secret, tx)
      if (participant.session.status !== 'OPEN' || participant.status === 'OFFLINE' || !participant.member) {
        throw new ApiError(409, 'Join an active classroom group before finishing an exercise.')
      }
      const groupId=participant.member.groupId
      await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id"=${groupId}::uuid FOR UPDATE`
      const progress=await tx.groupActivityProgress.findFirst({where:{id:progressId,assignment:{groupId},status:{in:activeProgressStatuses}},include:{activity:true}})
      if(!progress)throw new ApiError(409,'This exercise is no longer current for the group.')
      if(progress.activity.completionMethod==='STUDENT'){
        const existing=await tx.groupCompletionVote.findUnique({where:{progressId_participantId:{progressId,participantId:participant.id}}})
        if(!existing)await tx.groupCompletionVote.create({data:{progressId,participantId:participant.id,groupId}})
        const total=await tx.groupMember.count({where:{groupId}})
        const agreed=await tx.groupCompletionVote.count({where:{progressId,groupId}})
        if(!existing)await tx.systemEvent.create({data:{sessionId:participant.sessionId,groupId,type:'ACTIVITY_COMPLETION_VOTE',message:participant.name+' agreed that '+progress.activity.name+' is complete ('+agreed+'/'+total+').'}})
        if(!total||agreed<total)return {ok:true}
      }
      return this.updateActivityProgress(tx, participant.sessionId, groupId, progressId, participant.name, 'finish')
    })
  }
  async reviewActivity(sessionId: string, groupId: string, progressId: string, decision: 'complete' | 'return', message = '') {
    message = message.trim()
    if (message.length > 2000) throw new ApiError(400, 'The message must be 2000 characters or fewer.')
    return this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } })
      if (session.status !== 'OPEN') throw new ApiError(409, 'Reopen the classroom before reviewing the exercise.')
      return this.updateActivityProgress(tx, sessionId, groupId, progressId, 'Teacher', decision, message)
    })
  }
  private async activityTestSnapshot(tx: Tx, sessionId: string, groupId: string, progressId: string) {
    const progress = await tx.groupActivityProgress.findFirst({
      where: { id: progressId, status: 'SUBMITTED', assignment: { groupId, group: { sessionId, session: { status: 'OPEN' } } } },
      include: { activity: true },
    })
    if (!progress?.submissionId || progress.activity.completionMethod !== 'PROJECT' || !progress.activity.testConfig) {
      throw new ApiError(409, 'There is no current submission with configured tests.')
    }
    const editor = await tx.groupEditor.findUnique({
      where: { groupId_workspaceKey: { groupId, workspaceKey: progress.activityId } },
      include: { actions: { orderBy: { version: 'asc' } } },
    })
    const config = progress.activity.testConfig as ActivityTestConfig
    const fingerprint = hashToken(JSON.stringify([progress.submissionId, config, editor?.revision, editor?.version, editor ? null : progress.activity.starterProjectRef]))
    const cases = parseActivityTests(config)
    return { fingerprint, spec: config.spec, cases, xml: editor?.xml ?? (progress.activity.starterProjectRef.trim() || starterProject), actions: editor?.actions ?? [] }
  }
  async activityTestProject(sessionId: string, groupId: string, progressId: string) {
    const { cases, ...snapshot } = await this.db.$transaction(
      tx => this.activityTestSnapshot(tx, sessionId, groupId, progressId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    return { ...snapshot, inputs: cases.map(item => item.inputs) }
  }
  async recordActivityTests(sessionId: string, groupId: string, progressId: string, fingerprint: string, outputs: ({ actual: TestValue } | { error: string })[]) {
    return this.transaction(async tx => {
      const snapshot = await this.activityTestSnapshot(tx, sessionId, groupId, progressId)
      if (snapshot.fingerprint !== fingerprint || snapshot.cases.length !== outputs.length) {
        throw new ApiError(409, 'The submission or tests changed. Run the current tests again.')
      }
      const cases = snapshot.cases.map((item, index) => {
        const output = outputs[index]
        if ('error' in output) return { passed: false, detail: output.error }
        const expected = JSON.stringify(item.expected), actual = JSON.stringify(output.actual)
        return { passed: expected === actual, detail: ('Expected ' + expected + ' - Reported ' + actual).slice(0, 400) }
      })
      const result = { passed: cases.every(item => item.passed), cases }
      await tx.groupActivityProgress.update({ where: { id: progressId }, data: { testResult: result } })
      if (result.passed) await this.updateActivityProgress(tx, sessionId, groupId, progressId, 'Automatic tests', 'complete')
      return result
    })
  }
  async saveActivity(a: Activity, canEditTests = true) {
    a = { ...a, name: a.name.trim() }
    return this.namedWrite('Activity', a.name, a.id, async tx => {
      if (!canEditTests && (await tx.activity.findUnique({ where: { id: a.id }, select: { testConfig: true } }))?.testConfig) {
        throw new ApiError(401, 'Sign in as a teacher to edit this tested activity.')
      }
      await tx.activity.upsert({ where: { id: a.id }, create: { id: a.id, name: a.name, description: a.description, starterProjectRef: a.starterProject, starterProjectName:a.starterProjectName??'', estimatedMinutes: a.estimatedMinutes, category: a.category ?? 'General', completionMethod: completionMethods[a.completionMethod], testConfig: a.testConfig ?? Prisma.DbNull }, update: { name: a.name, description: a.description, starterProjectRef: a.starterProject, starterProjectName:a.starterProjectName??'', estimatedMinutes: a.estimatedMinutes, category: a.category ?? 'General', completionMethod: completionMethods[a.completionMethod], testConfig: a.testConfig ?? Prisma.DbNull } })
      await tx.activityRequirement.deleteMany({ where: { activityId: a.id } })
      await tx.activityRequirement.createMany({ data: a.requirements.map(r => ({ ...r, activityId: a.id })) })
      return a
    })
  }
  async savePlaylist(p: Playlist) {
    p = { ...p, name: p.name.trim() }
    return this.namedWrite('Playlist', p.name, p.id, async tx => {
      if (await tx.activity.count({ where: { id: { in: p.activityIds } } }) !== p.activityIds.length) throw new ApiError(400, 'The playlist contains an activity that no longer exists.')
      await tx.playlist.upsert({ where: { id: p.id }, create: { id: p.id, name: p.name, description: p.description }, update: { name: p.name, description: p.description } })
      const old = await tx.playlistItem.findMany({ where: { playlistId: p.id } })
      await tx.playlistItem.deleteMany({ where: { playlistId: p.id, activityId: { notIn: p.activityIds } } })
      // temporary positions lets reorder avoid the unique position constraint
      for (const item of old.filter(i => p.activityIds.includes(i.activityId))) await tx.playlistItem.update({ where: { id: item.id }, data: { position: item.position + 1000000 } })
      for (const [position, activityId] of p.activityIds.entries()) await tx.playlistItem.upsert({ where: { playlistId_activityId: { playlistId: p.id, activityId } }, create: { playlistId: p.id, activityId, position }, update: { position } })
      const groups = await tx.group.findMany({ where: { assignments: { some: { playlistId: p.id } } } })
      for (const g of groups) await this.syncGroup(tx, g.id)
      return p
    })
  }
  async deleteLibrary(kind: 'activity' | 'playlist', id: string) {
    await this.transaction(async tx => {
      if (kind === 'activity') await tx.activity.delete({ where: { id } })
      else await tx.playlist.delete({ where: { id } })
      for (const g of await tx.group.findMany()) await this.syncGroup(tx, g.id)
    })
  }
  async createGroup(sessionId: string, name: string) {
    return this.transaction(async tx => {
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } })
      if (session.status !== 'OPEN') throw new ApiError(409, 'Reopen the session before creating a group.')
      const group = await tx.group.create({ data: { sessionId, name } })
      await tx.systemEvent.create({ data: { sessionId, groupId: group.id, type: 'GROUP_CREATED', message: `${name} created.` } })
      return { id: group.id, name: group.name }
    })
  }
  async requireGroup(tx: Tx, sessionId: string, id: string) {
    const group = await tx.group.findFirst({ where: { id, sessionId } })
    if (!group) throw new ApiError(404, 'Group not found in this classroom session.')
    return group
  }
  async deleteGroup(sessionId: string, id: string) {
    await this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, id)
      await tx.group.delete({ where: { id } })
    })
  }
  private async reconcileCompletionVotes(tx:Tx,groupId:string){
    const group=await tx.group.findUnique({where:{id:groupId},include:{session:true,members:true}})
    if(!group||group.session.status!=='OPEN'||!group.members.length)return
    const progress=await tx.groupActivityProgress.findFirst({where:{assignment:{groupId},status:'IN_PROGRESS',activity:{completionMethod:'STUDENT'}},include:{votes:true}})
    if(progress&&progress.votes.length===group.members.length)await this.updateActivityProgress(tx,group.sessionId,groupId,progress.id,'All remaining group members','complete')
  }
  async deleteGroups(sessionId:string,groupIds:string[]){
    return this.transaction(async tx=>{
      if(!groupIds.length||new Set(groupIds).size!==groupIds.length||await tx.group.count({where:{sessionId,id:{in:groupIds}}})!==groupIds.length)throw new ApiError(404,'Every selected group must belong to this classroom.')
      await tx.group.deleteMany({where:{sessionId,id:{in:groupIds}}})
      return {ok:true}
    })
  }
  async logMembershipChanges(tx:Tx,sessionId:string,previous:{participantId:string;groupId:string}[],next:{participantId:string;groupId:string}[]) {
    const before=new Map(previous.map(m=>[m.participantId,m.groupId]))
    const after=new Map(next.map(m=>[m.participantId,m.groupId]))
    const counts=new Map<string,{joined:number;left:number}>()
    for(const participantId of new Set([...before.keys(),...after.keys()])) {
      const oldGroup=before.get(participantId),newGroup=after.get(participantId)
      if(oldGroup===newGroup)continue
      for(const [groupId,direction] of [[oldGroup,'left'],[newGroup,'joined']] as const) {
        if(!groupId)continue
        const count=counts.get(groupId)??{joined:0,left:0}
        count[direction]++;counts.set(groupId,count)
      }
    }
    await tx.systemEvent.createMany({data:[...counts].map(([groupId,count])=>({sessionId,groupId,type:'GROUP_MEMBERS_CHANGED',message:[count.joined?`${count.joined} student(s) joined this group.`:'',count.left?`${count.left} student(s) left this group.`:''].filter(Boolean).join(' ')}))})
    for(const groupId of counts.keys())await this.reconcileCompletionVotes(tx,groupId)
  }
  async moveStudents(sessionId: string, groupId: string, participantIds: string[]) {
    await this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      if (await tx.participant.count({ where: { id: { in: participantIds }, sessionId } }) !== participantIds.length) throw new ApiError(400, 'Every selected student must belong to this classroom session.')
      const previous=await tx.groupMember.findMany({where:{sessionId,participantId:{in:participantIds}}})
      const moved=participantIds.filter(id=>!previous.some(m=>m.participantId===id&&m.groupId===groupId))
      await tx.groupMember.deleteMany({ where: { participantId: { in: moved } } })
      await tx.groupMember.createMany({ data: moved.map(participantId => ({ groupId, participantId, sessionId })) })
      await this.logMembershipChanges(tx,sessionId,previous,participantIds.map(participantId=>({participantId,groupId})))
    })
  }
  async autoGroupStudents(sessionId:string,participantIds:string[]) {
    await this.transaction(async tx=>{
      if(await tx.participant.count({where:{id:{in:participantIds},sessionId}})!==participantIds.length)throw new ApiError(400,'Every selected student must belong to this classroom session.')
      const groups=await tx.group.findMany({where:{sessionId},orderBy:[{createdAt:'asc'},{id:'asc'}],include:{members:{select:{participantId:true}}}})
      if(!groups.length)throw new ApiError(409,'Create at least one group before using Auto Group.')
      const selected=new Set(participantIds)
      const previous=new Map(groups.flatMap(g=>g.members.map(m=>[m.participantId,g.id] as const)))
      const counts=new Map(groups.map(g=>[g.id,g.members.filter(m=>!selected.has(m.participantId)).length]))
      const changes:{sessionId:string;groupId:string;participantId:string}[]=[]
      for(const participantId of participantIds){
        const smallest=groups.reduce((best,g)=>counts.get(g.id)!<counts.get(best.id)!?g:best)
        const current=groups.find(g=>g.id===previous.get(participantId))
        const destination=current && counts.get(current.id)===counts.get(smallest.id)?current:smallest
        counts.set(destination.id,counts.get(destination.id)!+1)
        if(previous.get(participantId)!==destination.id)changes.push({sessionId,groupId:destination.id,participantId})
      }
      if(changes.length){
        await tx.groupMember.deleteMany({where:{sessionId,participantId:{in:changes.map(m=>m.participantId)}}})
        await tx.groupMember.createMany({data:changes})
        await this.logMembershipChanges(tx,sessionId,changes.flatMap(m=>previous.has(m.participantId)?[{participantId:m.participantId,groupId:previous.get(m.participantId)!}]:[]),changes)
      }
    })
  }
  async unassignStudents(sessionId:string,participantIds:string[]) {
    await this.transaction(async tx=>{
      if(await tx.participant.count({where:{id:{in:participantIds},sessionId}})!==participantIds.length)throw new ApiError(400,'Every selected student must belong to this classroom session.')
      const previous=await tx.groupMember.findMany({where:{sessionId,participantId:{in:participantIds}}})
      await tx.groupMember.deleteMany({where:{sessionId,participantId:{in:participantIds}}})
      await this.logMembershipChanges(tx,sessionId,previous,[])
    })
  }
  async assignWork(sessionId: string, groupIds: string[], kind: 'activity' | 'playlist', id: string) {
    await this.transaction(async tx => {
      if (kind === 'activity' ? !await tx.activity.findUnique({ where: { id } }) : !await tx.playlist.findUnique({ where: { id } })) throw new ApiError(404, 'Selected work no longer exists.')
      for (const groupId of groupIds) {
        await this.requireGroup(tx, sessionId, groupId)
        const activityId = kind === 'activity' ? id : null
        const playlistId = kind === 'playlist' ? id : null
        if (!await tx.groupAssignment.findFirst({ where: { groupId, activityId, playlistId } })) {
          await tx.groupAssignment.create({ data: { groupId, activityId, playlistId } })
          await tx.systemEvent.create({ data: { sessionId, groupId, type: 'WORK_ASSIGNED', message: `${kind === 'activity' ? 'Activity' : 'Playlist'} assigned.` } })
        }
        await this.syncGroup(tx, groupId)
      }
    })
  }
  async removeWork(sessionId: string, groupId: string, kind: 'activity' | 'playlist', id: string) {
    await this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      await tx.groupAssignment.deleteMany({ where: { groupId, ...(kind === 'activity' ? { activityId: id } : { playlistId: id }) } })
      await this.syncGroup(tx, groupId)
      await tx.systemEvent.create({ data: { sessionId, groupId, type: 'WORK_REMOVED', message: 'Work assignment removed.' } })
    })
  }
  async registerDevice(sessionId: string, data: { name: string; type: string; capabilities: string[]; status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' }) {
    return this.transaction(async tx => {
      const device = await tx.device.create({ data: { name: data.name, type: data.type, capabilities: { create: data.capabilities.map(capability => ({ capability })) } } })
      return tx.sessionDevice.create({ data: { sessionId, deviceId: device.id, status: data.status } })
    })
  }
  async unassignDevices(sessionId:string,deviceIds:string[]){
    await this.transaction(async tx=>{
      if(await tx.sessionDevice.count({where:{sessionId,id:{in:deviceIds}}})!==deviceIds.length)throw new ApiError(404,'Select devices from this classroom.')
      const assignments=await tx.deviceAssignment.findMany({where:{sessionId,sessionDeviceId:{in:deviceIds},status:'ACTIVE'}})
      await tx.deviceAssignment.updateMany({where:{sessionId,sessionDeviceId:{in:deviceIds},status:'ACTIVE'},data:{status:'RELEASED'}})
      for(const groupId of new Set(assignments.map(a=>a.groupId)))await tx.systemEvent.create({data:{sessionId,groupId,type:'DEVICES_UNASSIGNED',message:`${assignments.filter(a=>a.groupId===groupId).length} device(s) unassigned.`}})
    })
  }
  async autoAssignDevices(sessionId:string,deviceIds:string[]) {
    return this.transaction(async tx=>{
      if(await tx.sessionDevice.count({where:{sessionId,id:{in:deviceIds}}})!==deviceIds.length)throw new ApiError(400,'Select devices from this classroom.')
      const groups=await tx.group.findMany({where:{sessionId},orderBy:[{createdAt:'asc'},{id:'asc'}]})
      if(!groups.length)throw new ApiError(409,'Create a group before assigning devices.')
      const assignments=await tx.groupAssignment.findMany({where:{group:{sessionId}},include:{activity:{include:{requirements:true}},playlist:{include:{items:{include:{activity:{include:{requirements:true}}}}}}}})
      const devices=await tx.sessionDevice.findMany({where:{sessionId},include:{device:{include:{capabilities:true}},assignments:{where:{status:'ACTIVE'}}},orderBy:{id:'asc'}})
      const demand=groups.map(group=>({id:group.id,name:group.name,requirements:combineHardwareRequirements(assignments.filter(a=>a.groupId===group.id).flatMap(a=>a.activity?[a.activity]:a.playlist?.items.map(item=>item.activity)??[]))}))
      const pool=devices.filter(d=>d.assignments.length||deviceIds.includes(d.id)).map(d=>({id:d.id,type:d.device.type,capability:d.device.capabilities[0]?.capability??'',capabilities:d.device.capabilities.map(c=>c.capability),assignedGroupId:d.assignments[0]?.groupId}))
      const {assignments:planned,shortages}=planDeviceAssignments(demand,pool)
      if(planned.length){
        await tx.deviceAssignment.createMany({data:planned.map(a=>({...a,sessionId}))})
        for(const groupId of new Set(planned.map(a=>a.groupId)))await tx.systemEvent.create({data:{sessionId,groupId,type:'DEVICES_ASSIGNED',message:`${planned.filter(a=>a.groupId===groupId).length} device(s) automatically assigned to activity requirements.`}})
      }
      return {assignedCount:planned.length,shortages}
    })
  }
  private async loadReplacementPlan(tx: Tx, sessionId: string) {
    const groups = await tx.group.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, include: { assignments: { orderBy: { assignedAt: 'asc' }, include: { progress: { include: { votes:true, activity: { include: { requirements: true } } } } } } } })
    const devices = await tx.sessionDevice.findMany({ where: { sessionId }, include: { device: { include: { capabilities: true } }, runtime: true, assignments: { where: { status: 'ACTIVE' } } } })
    const disconnects = await tx.systemEvent.findMany({ where: { sessionId, type: 'DEVICE_OFFLINE', sessionDeviceId: { not: null } }, distinct: ['sessionDeviceId'], orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, sessionDeviceId: true } })
    const rejected = await tx.alert.findMany({ where: { group: { sessionId }, status: 'REJECTED', type: { startsWith: rejectionPrefix } }, select: { type: true } })
    const controls = await this.deviceControls(devices, sessionId, tx)
    const work = groups.map(group => {
      const progress = group.assignments.flatMap(assignment => assignment.progress)
      return { id: group.id, name: group.name, deviceIds: devices.filter(device => device.assignments.some(assignment => assignment.groupId === group.id)).map(device => device.id), activityId: progress.find(item => activeProgressStatuses.includes(item.status))?.activityId, progress: progress.map(item => ({ activityId: item.activityId, status: item.status.toLowerCase() as NonNullable<Group['progress']>[number]['status'] })) }
    })
    const activities = [...new Map(groups.flatMap(group => group.assignments.flatMap(assignment => assignment.progress.map(item => [item.activityId, { id: item.activityId, requirements: item.activity.requirements }] as const)))).values()]
    const pool = devices.map(device => ({ id: device.id, name: device.device.name, type: device.device.type, capability: device.device.capabilities[0]?.capability ?? '', capabilities: device.device.capabilities.map(item => item.capability), status: device.status.toLowerCase() as Device['status'], runtime: device.runtime, assignedGroupId: device.assignments[0]?.groupId, control: device.runtime ? controls.get(deviceControlKey(device.runtime)) : undefined, disconnectKey: (disconnects.find(event => event.sessionDeviceId === device.id)?.id ?? 'offline') + ':' + (device.assignments[0]?.id ?? 'unassigned') }))
    return { plans: planDeviceReplacements(work, activities, pool, new Set(rejected.map(item => item.type.slice(rejectionPrefix.length)))), devices, groups }
  }
  async reviewDeviceReplacement(sessionId: string, groupId: string, failedDeviceId: string, replacementDeviceId: string, sourceGroupId: string | null, failureKey: string, decision: 'approve' | 'reject') {
    return this.transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "SessionDevice" WHERE "sessionId" = ${sessionId}::uuid AND id IN (${failedDeviceId}::uuid, ${replacementDeviceId}::uuid) ORDER BY id FOR UPDATE`)
      await this.requireGroup(tx, sessionId, groupId)
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } })
      if (session.status !== 'OPEN') throw new ApiError(409, 'Reopen the classroom before reviewing a replacement.')
      const { plans, devices, groups } = await this.loadReplacementPlan(tx, sessionId)
      const plan = plans.find(item => item.groupId === groupId && item.failedDeviceId === failedDeviceId)
      if (!plan || plan.failureKey !== failureKey || plan.replacementDeviceId !== replacementDeviceId || plan.sourceGroupId !== sourceGroupId) throw new ApiError(409, 'The replacement suggestion changed. Review the latest alert.')
      const failed = devices.find(device => device.id === failedDeviceId)!
      const replacement = devices.find(device => device.id === replacementDeviceId)!
      const label = (device: typeof failed) => device.device.name + ' (' + device.device.type + ')'
      if (decision === 'reject') {
        await tx.alert.create({ data: { groupId, sessionDeviceId: failedDeviceId, type: rejectionPrefix + failureKey, status: 'REJECTED', message: 'Teacher rejected ' + label(replacement) + '. ' + label(failed) + ' remains disconnected.' } })
        await tx.systemEvent.create({ data: { sessionId, groupId, sessionDeviceId: failedDeviceId, type: 'DEVICE_REPLACEMENT_REJECTED', message: 'Teacher rejected ' + label(replacement) + ' as a replacement for ' + label(failed) + '.' } })
        return { ok: true }
      }
      await tx.deviceAssignment.updateMany({ where: { sessionId, sessionDeviceId: failedDeviceId, groupId, status: 'ACTIVE' }, data: { status: 'RELEASED' } })
      if (sourceGroupId) await tx.deviceAssignment.updateMany({ where: { sessionId, sessionDeviceId: replacementDeviceId, groupId: sourceGroupId, status: 'ACTIVE' }, data: { status: 'RELEASED' } })
      await tx.deviceAssignment.create({ data: { sessionId, sessionDeviceId: replacementDeviceId, groupId } })
      const source = groups.find(group => group.id === sourceGroupId)
      await tx.systemEvent.create({ data: { sessionId, groupId, sessionDeviceId: replacementDeviceId, type: 'DEVICE_REPLACED', message: label(replacement) + (source ? ' from ' + source.name : '') + ' replaced ' + label(failed) + ' with teacher approval.' } })
      if (source) await tx.systemEvent.create({ data: { sessionId, groupId: source.id, sessionDeviceId: replacementDeviceId, type: 'DEVICE_TRANSFERRED', message: label(replacement) + ' was transferred to ' + groups.find(group => group.id === groupId)!.name + ' with teacher approval.' } })
      return { ok: true }
    })
  }
  async assignDevices(sessionId: string, groupId: string, deviceIds: string[]) {
    await this.transaction(async tx => {
      await this.requireGroup(tx, sessionId, groupId)
      const devices = await tx.sessionDevice.findMany({ where: { id: { in: deviceIds }, sessionId } })
      if (devices.length !== deviceIds.length) throw new ApiError(400, 'Select devices from this session.')
      await tx.deviceAssignment.updateMany({ where: { sessionDeviceId: { in: deviceIds }, status: 'ACTIVE' }, data: { status: 'RELEASED' } })
      await tx.deviceAssignment.createMany({ data: deviceIds.map(sessionDeviceId => ({ sessionId, groupId, sessionDeviceId })) })
      await tx.systemEvent.create({ data: { sessionId, groupId, type: 'DEVICES_ASSIGNED', message: `${deviceIds.length} device(s) assigned.` } })
    })
  }
}
