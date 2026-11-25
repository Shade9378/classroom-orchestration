import {randomUUID} from 'node:crypto'
import {Prisma,type PrismaClient,type DeviceControl as Lease} from '@prisma/client'
import {z} from 'zod'
import {ApiError,hashToken,type ClassroomService} from './service.js'
import {deviceControlKey} from '../src/devices/control.js'
export const deviceCommand=z.object({method:z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100),args:z.record(z.string().max(100),z.unknown()).default({}),transport:z.enum(['native','iotscape']).default('native')})
export type DeviceCommand=z.infer<typeof deviceCommand>
type Tx=Prisma.TransactionClient
type Runtime={mode:string;serviceName:string|null;remoteDeviceId:string|null}
export class DeviceControls {
  readonly leaseMs=90000
  constructor(private db:PrismaClient,private service:ClassroomService,private execute:(sessionId:string,r:Runtime,command:DeviceCommand)=>Promise<unknown>,private stop:(r:Runtime)=>Promise<void>,private notify:()=>void){}
  private gate<T>(key:string,action:(tx:Tx)=>Promise<T>){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`
    return action(tx)
  },{timeout:25000,maxWait:15000})}
  private async running(tx:Tx,participantId:string,runId:string){
    const run=await tx.deviceRun.upsert({where:{participantId_runId:{participantId,runId}},create:{participantId,runId},update:{}})
    await tx.$queryRaw`SELECT "runId" FROM "DeviceRun" WHERE "participantId"=${participantId}::uuid AND "runId"=${runId}::uuid FOR UPDATE`
    if(run.finished||(await tx.deviceRun.findUniqueOrThrow({where:{participantId_runId:{participantId,runId}}})).finished)throw new ApiError(409,'This program has finished or was stopped. Run it again to take control.')
  }
  private async awaitingReview(tx:Tx,groupId:string){
    return !!await tx.groupActivityProgress.findFirst({where:{assignment:{groupId},status:'SUBMITTED'},select:{id:true}})
  }
  private async context(tx:Tx,token:string,id:string){
    const p=await this.service.student(token,tx)
    if(p.session.status!=='OPEN'||p.status==='OFFLINE'||p.lastSeenAt.getTime()+ (p.status==='AWAY'?this.service.awayTimeoutMs:this.service.timeoutMs)<this.service.now().getTime())throw new ApiError(409,'Reconnect to your classroom before controlling a device.')
    if(!p.member)throw new ApiError(403,'Join an assigned group before controlling a device.')
    if(await this.awaitingReview(tx,p.member.groupId))throw new ApiError(409,'This exercise is waiting for teacher review.')
    const assignment=await tx.deviceAssignment.findFirst({where:{sessionDeviceId:id,groupId:p.member.groupId,sessionId:p.sessionId,status:'ACTIVE'},include:{sessionDevice:{include:{runtime:true}}}})
    const r=assignment?.sessionDevice.runtime
    if(!assignment||!r?.serviceName||!r.remoteDeviceId||!['iotscape','roboscape','phoneiot'].includes(r.mode))throw new ApiError(403,'This device is not assigned to your current group.')
    if(assignment.sessionDevice.status!=='ONLINE'||r.state==='paused')throw new ApiError(409,'The device is offline or disconnected.')
    return {p,r,sourceKey:deviceControlKey(r)}
  }
  private async valid(tx:Tx,lease:Lease){
    if(lease.expiresAt<=this.service.now())return false
    if((await tx.deviceRun.findUnique({where:{participantId_runId:{participantId:lease.participantId,runId:lease.runId}}}))?.finished)return false
    const p=await tx.participant.findUnique({where:{id:lease.participantId},include:{session:true,member:true}})
    if(!p||p.tokenHash!==lease.ownerTokenHash||p.status==='OFFLINE'||p.session.status!=='OPEN'||p.member?.groupId!==lease.groupId)return false
    if(p.lastSeenAt.getTime()+(p.status==='AWAY'?this.service.awayTimeoutMs:this.service.timeoutMs)<this.service.now().getTime())return false
    if(await this.awaitingReview(tx,lease.groupId))return false
    return !!await tx.deviceAssignment.findFirst({where:{sessionDeviceId:lease.sessionDeviceId,groupId:lease.groupId,status:'ACTIVE',sessionDevice:{status:'ONLINE',runtime:{state:{not:'paused'}}}}})
  }
  private async event(tx:Tx,lease:Lease,type:string,message:string){
    const group=await tx.group.findUnique({where:{id:lease.groupId}})
    if (group) {
      const connection = await tx.sessionDevice.findUnique({ where: { id: lease.sessionDeviceId }, include: { device: true } })
      const label = connection ? connection.device.name + ' (' + connection.device.type + '): ' : ''
      await tx.systemEvent.create({ data: { sessionId: group.sessionId, groupId: group.id, sessionDeviceId: connection?.id, type, message: label + message } })
    }
  }
  private async release(tx:Tx,lease:Lease,reason:string){
    try{await this.stop(lease)}catch{throw new ApiError(503,'The robot could not be stopped. Control stays reserved; reconnect the robot and retry releasing it.')}
    await tx.deviceControl.delete({where:{sourceKey:lease.sourceKey}})
    await this.event(tx,lease,'DEVICE_CONTROL_RELEASED',reason)
  }
  async acquire(token:string,id:string,runId:string){
    const preliminary=await this.context(this.db,token,id)
    const acquired=await this.gate(preliminary.sourceKey,async tx=>{
      const {p,r,sourceKey}=await this.context(tx,token,id)
      await this.running(tx,p.id,runId)
      let current=await tx.deviceControl.findUnique({where:{sourceKey}})
      if(current&&!await this.valid(tx,current)){await this.release(tx,current,'Device control expired or its owner left the assigned group.');current=null}
      if(current&&current.participantId!==p.id){
        const owner=await tx.participant.findUnique({where:{id:current.participantId}})
        throw new ApiError(409,`${owner?.sessionId===p.sessionId?owner.name:'Another student'} is controlling this device. Wait until their program finishes.`)
      }
      const sameRun=current?.runId===runId
      const lease=await tx.deviceControl.upsert({where:{sourceKey},create:{sourceKey,sessionDeviceId:id,participantId:p.id,ownerTokenHash:hashToken(token),groupId:p.member!.groupId,runId,leaseId:randomUUID(),mode:r.mode,serviceName:r.serviceName!,remoteDeviceId:r.remoteDeviceId!,expiresAt:new Date(this.service.now().getTime()+this.leaseMs)},update:{sessionDeviceId:id,groupId:p.member!.groupId,runId,...(!sameRun?{leaseId:randomUUID()}:{}),expiresAt:new Date(this.service.now().getTime()+this.leaseMs)}})
      if(!current)await this.event(tx,lease,'DEVICE_CONTROL_ACQUIRED',`${p.name} took control of a device.`)
      return {leaseId:lease.leaseId,expiresAt:lease.expiresAt.toISOString()}
    })
    this.notify();return acquired
  }
  async command(token:string,id:string,runId:string,command:DeviceCommand){
    const {leaseId}=await this.acquire(token,id,runId)
    const initial=await this.context(this.db,token,id)
    const result=await this.gate(initial.sourceKey,async tx=>{
      const {p,r,sourceKey}=await this.context(tx,token,id)
      await this.running(tx,p.id,runId)
      const lease=await tx.deviceControl.findUnique({where:{sourceKey}})
      if(!lease||lease.participantId!==p.id||lease.leaseId!==leaseId||lease.runId!==runId||!await this.valid(tx,lease))throw new ApiError(409,'Device control ended. Run the program again.')
      const value=await this.execute(p.sessionId,r,command)
      await this.event(tx,lease,'DEVICE_COMMAND',`${p.name} called ${r.serviceName}.${command.method}.`)
      return value
    })
    return {result,leaseId}
  }
  async renew(token:string,id:string,runId:string,leaseId:string){
    const initial=await this.context(this.db,token,id)
    return this.gate(initial.sourceKey,async tx=>{
      const {p,sourceKey}=await this.context(tx,token,id),lease=await tx.deviceControl.findUnique({where:{sourceKey}})
      if(!lease||lease.participantId!==p.id||lease.runId!==runId||lease.leaseId!==leaseId||!await this.valid(tx,lease))throw new ApiError(409,'Device control ended. Run the program again.')
      await tx.deviceControl.update({where:{sourceKey},data:{expiresAt:new Date(this.service.now().getTime()+this.leaseMs)}})
      return {ok:true}
    })
  }
  async finish(token:string,runId:string){
    const p=await this.service.student(token)
    await this.db.deviceRun.upsert({where:{participantId_runId:{participantId:p.id,runId}},create:{participantId:p.id,runId,finished:true},update:{finished:true}})
    for(const candidate of await this.db.deviceControl.findMany({where:{participantId:p.id,ownerTokenHash:hashToken(token),runId}}))await this.gate(candidate.sourceKey,async tx=>{
      const current=await tx.deviceControl.findUnique({where:{sourceKey:candidate.sourceKey}})
      if(current?.participantId===p.id&&current.runId===runId&&current.ownerTokenHash===hashToken(token))await this.release(tx,current,`${p.name} finished or stopped their program.`)
    })
    this.notify();return {ok:true}
  }
  async identify<T>(id:string,action:(sessionId:string,r:Runtime)=>Promise<T>){
    const row=await this.db.deviceRuntime.findUnique({where:{sessionDeviceId:id},include:{device:true}})
    if(!row)throw new ApiError(404,'The saved device connection was removed.')
    return this.db.$transaction(async tx=>{
      const key=deviceControlKey(row)
      const [lock]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS locked`
      if(!lock.locked||await tx.deviceControl.findUnique({where:{sourceKey:key}}))throw new ApiError(409,'A command is running on this device. Try again when it finishes.')
      const fresh=await tx.deviceRuntime.findUnique({where:{sessionDeviceId:id},include:{device:{include:{session:true}}}})
      if(!fresh||fresh.state==='paused'||fresh.device.session.status!=='OPEN')throw new ApiError(409,'The device was disconnected or the classroom was closed.')
      return action(fresh.device.sessionId,fresh)
    },{timeout:60000,maxWait:1000})
  }
  async teacherCommand(id:string,command:DeviceCommand){
    const row=await this.db.deviceRuntime.findUniqueOrThrow({where:{sessionDeviceId:id},include:{device:true}})
    return this.gate(deviceControlKey(row),async tx=>{
      const lease=await tx.deviceControl.findUnique({where:{sourceKey:deviceControlKey(row)}})
      if(lease){if(await this.valid(tx,lease))throw new ApiError(409,'A student is controlling this device. Release their control first.');await this.release(tx,lease,'Expired device control released.')}
      return this.execute(row.device.sessionId,row,command)
    })
  }
  async forceRelease(sessionId:string,id:string){
    const row=await this.db.deviceRuntime.findFirst({where:{sessionDeviceId:id,device:{sessionId}}})
    if(!row)throw new ApiError(404,'Device not found in this classroom.')
    await this.gate(deviceControlKey(row),async tx=>{
      const lease=await tx.deviceControl.findUnique({where:{sourceKey:deviceControlKey(row)}})
      if(lease){
        const group=await tx.group.findUnique({where:{id:lease.groupId}})
        if(group&&group.sessionId!==sessionId)throw new ApiError(403,'This device is controlled in another classroom.')
        await tx.deviceRun.updateMany({where:{participantId:lease.participantId,runId:lease.runId},data:{finished:true}})
        await this.release(tx,lease,'The teacher released device control.')
      }
    });this.notify();return {ok:true}
  }
  async expire(){
    let changed=false
    const errors:unknown[]=[]
    for(const row of await this.db.deviceControl.findMany())try{await this.gate(row.sourceKey,async tx=>{
      const lease=await tx.deviceControl.findUnique({where:{sourceKey:row.sourceKey}})
      if(lease&&!await this.valid(tx,lease)){await this.release(tx,lease,'Device control expired or its owner disconnected.');changed=true}
    })}catch(e){errors.push(e)}
    if(changed)this.notify()
    await this.db.deviceRun.deleteMany({where:{finished:true,updatedAt:{lt:new Date(this.service.now().getTime()-86400000)}}})
    if(errors.length)throw new AggregateError(errors,'Some device controls could not be released')
  }
}
