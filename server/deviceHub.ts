import {deviceControlKey} from '../src/devices/control.js'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma,type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ApiError,hashToken,type ClassroomService } from './service.js'
const uuid=z.string().uuid(),text=z.string().trim().min(1).max(100)
const readings=z.record(z.string().max(100),z.object({value:z.union([z.number().finite().min(-1e12).max(1e12),z.string().max(256)]),unit:z.string().max(40)})).refine(r=>Object.keys(r).length<=50,'At most 50 readings')
const controlState=z.object({speed:z.number().min(0).max(255).optional(),heading:z.number().min(0).max(359).optional(),led:z.string().max(20).optional(),vibrating:z.boolean().optional(),temperature:z.number().min(-40).max(125).optional(),humidity:z.number().min(0).max(100).optional()}).strict()
const sample=z.object({controls:controlState.optional(),telemetry:readings.default({}),sampledAt:z.string().datetime().nullable().optional(),battery:z.number().min(0).max(100).optional(),latencyMs:z.number().int().min(0).max(60000).optional(),degraded:z.boolean().default(false)})
const attachment=sample.extend({targetId:uuid.optional(),sourceId:z.string().min(1).max(256),name:text,type:text,mode:z.enum(['bluetooth','iotscape','roboscape','phoneiot']),serviceName:text.optional(),telemetryServiceName:text.optional(),remoteDeviceId:z.string().trim().min(1).max(128).optional(),profile:z.enum(['galaxy-s23','sphero-bolt','sht40','custom']),model:text,manufacturer:text,capabilities:z.array(text).min(1).max(20).refine(a=>new Set(a.map(c=>c.toLowerCase())).size===a.length,'Capabilities must be unique'),intervalMs:z.number().int().min(500).max(10000).default(1000),packetLoss:z.number().int().min(0).max(100).default(0),services:z.array(z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)).max(10).default([])})
export class DeviceHub {
  constructor(private db:PrismaClient,private service:ClassroomService,private notify:()=>void,private now=()=>new Date()){}
  private identity(d:{mode:string;sourceId:string;serviceName?:string;remoteDeviceId?:string}):Prisma.DeviceRuntimeWhereInput{
    return d.mode==='bluetooth'?{mode:d.mode,bluetoothId:d.sourceId}:{mode:d.mode,serviceName:d.serviceName,remoteDeviceId:d.mode==='iotscape'?d.remoteDeviceId:{equals:d.remoteDeviceId,mode:'insensitive'}}
  }
  async ensureNotConnected(tx:Prisma.TransactionClient,d:{mode:string;sourceId:string;serviceName?:string;remoteDeviceId?:string;sessionId:string}){
    const key='device-connection:'+ (d.mode==='bluetooth'?d.sourceId:deviceControlKey({mode:d.mode,serviceName:d.serviceName??null,remoteDeviceId:d.remoteDeviceId??null}))
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`
    const existing=await tx.deviceRuntime.findFirst({where:{...this.identity(d),state:{not:'paused'},device:{session:{status:'OPEN'},OR:[{sessionId:d.sessionId,status:{in:['ONLINE','DEGRADED']}},{sessionId:{not:d.sessionId}}]}},include:{device:{include:{device:true,session:true}}}})
    if(existing)throw new ApiError(409,existing.device.sessionId===d.sessionId?'This device is already connected. Open its saved details instead.':existing.device.device.name+' ('+existing.device.device.type+') is already connected in '+existing.device.session.name+'. Open its saved details instead.')
  }
  async event(tx:Prisma.TransactionClient,id:string,type:string,message:string) {
    const d=await tx.sessionDevice.findUniqueOrThrow({where:{id},include:{device:true,assignments:{where:{status:'ACTIVE'}}}})
    for(const groupId of new Set(d.assignments.map(a=>a.groupId)))await tx.systemEvent.create({data:{sessionId:d.sessionId,groupId,sessionDeviceId:id,type,message:`${d.device.name} (${d.device.type}): ${message}`}})
  }
  async attach(sessionId:string,input:unknown) {
    const d=attachment.parse(input),token=randomBytes(32).toString('hex')
    const result=await this.service.transaction(async tx=>{
      if((await tx.session.findUniqueOrThrow({where:{id:sessionId}})).status!=='OPEN')throw new ApiError(409,'Reopen the classroom before connecting a device.')
      await this.ensureNotConnected(tx,{...d,sessionId})
      let connection=await tx.sessionDevice.findFirst({where:{sessionId,...(d.targetId?{id:d.targetId}:{runtime:this.identity(d)})},include:{runtime:true}})
      if(d.targetId&&(!connection||connection.runtime?.bluetoothId!==d.sourceId||connection.runtime.mode!==d.mode))throw new ApiError(409,'Choose the same device to reconnect this saved connection, or connect it as a new device.')
      if(!connection){
        if(await tx.sessionDevice.findFirst({where:{sessionId,device:{name:{equals:d.name,mode:'insensitive'}}}}))throw new ApiError(409,'A different saved device already has this name. Rename the local device or remove the old connection.')
        const device=await tx.device.create({data:{name:d.name,type:d.type,capabilities:{create:d.capabilities.map(capability=>({capability}))}}})
        connection=await tx.sessionDevice.create({data:{sessionId,deviceId:device.id,status:d.degraded?'DEGRADED':'ONLINE'},include:{runtime:true}})
      }
      if(await tx.sessionDevice.findFirst({where:{sessionId,id:{not:connection.id},device:{name:{equals:d.name,mode:'insensitive'}}}}))throw new ApiError(409,'Another saved device has this name.')
      await tx.device.update({where:{id:connection.deviceId},data:{name:d.name,type:d.type}})
      await tx.deviceCapability.deleteMany({where:{deviceId:connection.deviceId}})
      await tx.deviceCapability.createMany({data:d.capabilities.map(capability=>({deviceId:connection.deviceId,capability}))})
      const data={mode:d.mode,serviceName:d.serviceName??null,telemetryServiceName:d.telemetryServiceName??null,remoteDeviceId:d.remoteDeviceId??null,profile:d.profile,model:d.model,manufacturer:d.manufacturer,state:d.degraded?'degraded':'connected',paired:true,bluetoothId:d.sourceId,services:d.services,intervalMs:d.intervalMs,latencyMs:d.latencyMs??0,packetLoss:d.packetLoss,battery:d.battery??100,telemetry:d.telemetry,sampledAt:d.sampledAt?new Date(d.sampledAt):null,connectedAt:this.now(),tokenHash:d.mode==='bluetooth'?hashToken(token):null,controls:d.controls??{}}
      await tx.deviceRuntime.upsert({where:{sessionDeviceId:connection.id},create:{sessionDeviceId:connection.id,...data},update:data})
      await tx.sessionDevice.update({where:{id:connection.id},data:{status:d.degraded?'DEGRADED':'ONLINE',lastSeenAt:this.now(),batteryLevel:d.battery===undefined?null:Math.floor(d.battery),latencyMs:d.latencyMs??null}})
      await this.event(tx,connection.id,'DEVICE_ONLINE',`${d.serviceName??'Bluetooth GATT'} connected.`)
      return {id:connection.id,token}
    })
    return result
  }
  async report(id:string,token:string,input:unknown) {
    const d=sample.extend({connected:z.boolean()}).parse(input)
    return this.db.$transaction(async tx=>{
      // lock this connection so token changes dont serialize unrelated device reports
      await tx.$queryRaw(Prisma.sql`SELECT "sessionDeviceId" FROM "DeviceRuntime" WHERE "sessionDeviceId"=${id}::uuid FOR UPDATE`)
      const r=await tx.deviceRuntime.findUnique({where:{sessionDeviceId:id},include:{device:{include:{session:true}}}})
      if(!r||!r.tokenHash||r.tokenHash!==hashToken(token))throw new ApiError(401,'Device connection token is invalid.')
      if(r.device.session.status!=='OPEN'&&d.connected)throw new ApiError(409,'The classroom is closed.')
      const state=d.connected?(d.degraded?'degraded':'connected'):'disconnected'
      await tx.deviceRuntime.update({where:{sessionDeviceId:id},data:{state,controls:d.controls,telemetry:d.telemetry,sampledAt:d.sampledAt?new Date(d.sampledAt):null,...(d.battery===undefined?{}:{battery:d.battery}),...(!d.connected?{tokenHash:null}:{})}})
      await tx.sessionDevice.update({where:{id},data:{status:d.connected?(d.degraded?'DEGRADED':'ONLINE'):'OFFLINE',lastSeenAt:this.now(),batteryLevel:d.battery===undefined?undefined:Math.floor(d.battery),latencyMs:d.latencyMs}})
      if(state!==r.state)await this.event(tx,id,!d.connected?'DEVICE_OFFLINE':d.degraded?'DEVICE_DEGRADED':'DEVICE_ONLINE',`${r.mode==='simulated'?'local simulated Bluetooth':'Bluetooth'} ${state}.`)
      return {ok:true}
    })
  }
  async tick() {
    const rows=await this.db.deviceRuntime.findMany({where:{mode:'bluetooth',state:{in:['connecting','connected','degraded']}},select:{sessionDeviceId:true}})
    let changed=false
    for(const {sessionDeviceId:id} of rows)await this.service.transaction(async tx=>{
      const r=await tx.deviceRuntime.findUnique({where:{sessionDeviceId:id},include:{device:{include:{session:true}}}})
      if(!r||!['connecting','connected','degraded'].includes(r.state))return
      if(!r.tokenHash||r.device.session.status!=='OPEN'||this.now().getTime()-r.device.lastSeenAt.getTime()>20000){
        await tx.deviceRuntime.update({where:{sessionDeviceId:id},data:{state:'disconnected',tokenHash:null,controls:{}}})
        await tx.sessionDevice.update({where:{id},data:{status:'OFFLINE'}})
        await this.event(tx,id,'DEVICE_OFFLINE','connection expired or classroom closed.');changed=true
      }
    })
    if(changed)this.notify()
  }
}
export function registerDeviceHub(app:FastifyInstance,db:PrismaClient,service:ClassroomService,owner:(r:FastifyRequest)=>Promise<string>,notify:()=>void,now?:()=>Date) {
  const hub=new DeviceHub(db,service,notify,now),path='/api/sessions/:sessionId/device-connections'
  const id=(r:FastifyRequest)=>uuid.parse((r.params as {id:string}).id)
  app.post(`${path}/connect`,async r=>{const result=await hub.attach(await owner(r),attachment.extend({mode:z.literal('bluetooth')}).parse(r.body));notify();return result})
  app.post(path,async r=>{await owner(r);throw new ApiError(400,'Connect a running local simulator or a Bluetooth device first.')})
  app.post(`${path}/:id/connection`,async r=>{await owner(r);throw new ApiError(400,'Pair with the local device from the dashboard; simulations do not run on the server.')})
  app.post(`${path}/:id/command`,async r=>{await owner(r);throw new ApiError(400,'Commands must be sent through the connected local device transport.')})
  app.delete(`${path}/:id`,async r=>{
    const sessionId=await owner(r),deviceId=id(r)
    await service.transaction(async tx=>{
      if(!await tx.sessionDevice.findFirst({where:{id:deviceId,sessionId}}))throw new ApiError(404,'Device not found in this classroom.')
      await hub.event(tx,deviceId,'DEVICE_REMOVED','removed from the classroom.')
      await tx.sessionDevice.delete({where:{id:deviceId}})
    });notify();return {ok:true}
  })
  app.post('/api/device-connections/:id/heartbeat',async r=>{
    if(!r.headers.authorization?.startsWith('Bearer '))throw new ApiError(401,'Device token required.')
    const result=await hub.report(id(r),z.string().min(32).max(128).parse(r.headers.authorization.slice(7)),r.body);notify();return result
  })
  let busy=false;const timer=setInterval(()=>{if(!busy){busy=true;void hub.tick().catch(e=>app.log.error(e)).finally(()=>{busy=false})}},500)
  timer.unref();app.addHook('onClose',async()=>clearInterval(timer));return hub
}
