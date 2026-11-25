import { DeviceIdentification, signalDevice } from './deviceIdentification.js'
import {batteryPercentage} from '../src/devices/vitals.js'
import type {Readings} from '../src/devices/profiles.js'
import {DeviceControls,deviceCommand} from './deviceControl.js'
import type {ClassroomService} from './service.js'
import type {DeviceProvisioning} from './deviceProvisioning.js'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient, Prisma } from '@prisma/client'
import { z } from 'zod'
import { ApiError } from './service.js'
import type { DeviceHub } from './deviceHub.js'

const word=z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100)
const identity=z.object({mode:z.enum(['iotscape','roboscape','phoneiot']),serviceName:word,telemetryServiceName:word.nullable().optional(),remoteDeviceId:z.string().trim().min(1).max(128)})
const reading=z.record(z.string().max(100),z.object({value:z.union([z.number().finite(),z.string().max(256)]),unit:z.string().max(40)}))
export class NetsBloxDevices {
  readonly clientId='classroom-'+randomUUID()
  constructor(readonly base=(process.env.NETSBLOX_SERVICES_URL??'https://services.netsblox.org').replace(/\/$/,''),private transport:typeof fetch=fetch){}
  fork(){return new NetsBloxDevices(this.base,this.transport)}
  async request(path:string,body?:unknown):Promise<unknown> {
    try {
      const r=await this.transport(`${this.base}/${path}${body===undefined?'':`?clientId=${this.clientId}`}`,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)})
      const text=await r.text()
      if(!r.ok)throw new Error(text.slice(0,200)||r.statusText)
      try{return JSON.parse(text)}catch{return text}
    }catch(e){throw new ApiError(502,`NetsBlox: ${e instanceof Error?e.message:'service unavailable'}`)}
  }
  rpc(service:string,method:string,args:unknown={}){return this.request(`${word.parse(service)}/${word.parse(method)}`,args)}
  async discover(mode:'iotscape'|'roboscape',serviceName?:string){
    if(mode==='roboscape')return {services:['RoboScape'],devices:z.array(z.string()).parse(await this.rpc('RoboScape','getRobots')),serviceName:'RoboScape'}
    if(!serviceName)return {services:z.array(z.string()).parse(await this.rpc('IoTScape','getServices')),devices:[],serviceName:''}
    return {services:[serviceName],devices:z.array(z.string()).parse(await this.rpc('IoTScape','getDevices',{service:word.parse(serviceName)})),serviceName}
  }
  async methods(service:string){
    const metadata=await this.request(word.parse(service)) as {rpcs?:Record<string,{args?:{name:string}[];description?:string}>}
    return Object.entries(metadata.rpcs??{}).filter(([name])=>word.safeParse(name).success).map(([name,r])=>({name,args:(r.args??[]).map(a=>a.name),description:r.description??''}))
  }
  async verify(d:z.infer<typeof identity>){
    if(d.mode==='phoneiot'){
      if(d.serviceName!=='PhoneIoT')throw new ApiError(400,'Choose PhoneIoT for a phone.')
      await this.rpc('PhoneIoT','authenticate',{device:d.remoteDeviceId});return
    }
    if(d.mode==='roboscape'&&d.serviceName!=='RoboScape')throw new ApiError(400,'Choose RoboScape for a robot.')
    if(!(await this.discover(d.mode,d.serviceName)).devices.includes(d.remoteDeviceId))throw new ApiError(409,'This device is not available through the selected NetsBlox service.')
    if(d.mode==='roboscape'){
      const alive=await this.rpc('RoboScape','send',{robot:d.remoteDeviceId,command:'is alive'})
      if(alive!==true&&alive!=='true')throw new ApiError(409,'The robot is offline.')
    }
  }
  async iotReadings(serviceName:string,id:string):Promise<Readings>{
    const methods=await this.methods(serviceName),result:Readings={}
    if(methods.some(m=>m.name==='getReadings')){
      const raw=await this.rpc(serviceName,'getReadings',{id})
      if(!Array.isArray(raw))throw new ApiError(502,'Invalid device readings.')
      Object.assign(result,reading.parse(Object.fromEntries(raw.map((r:unknown)=>{const [name,value,unit]=z.tuple([z.string(),z.union([z.string(),z.number()]),z.string()]).parse(r);return [name,{value,unit}]}))))
    }
    for(const [method,name,unit] of [['getBatteryLevel','batteryLevel','%']] as const){
      if(result[name]||!methods.some(m=>m.name===method&&m.args[0]==='id'))continue
      try{const value=await this.rpc(serviceName,method,{id});if(typeof value==='string'||typeof value==='number')result[name]={value,unit}}catch{}
    }
    return result
  }
  async sample(d:z.infer<typeof identity>){
    if(d.mode==='phoneiot'){
      await this.verify(d)
      try{
        const vector=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).parse(await this.rpc('PhoneIoT','getAccelerometer',{device:d.remoteDeviceId}))
        return Object.fromEntries(vector.map((value,i)=>[['accelerationX','accelerationY','accelerationZ'][i],{value,unit:'m/s^2'}]))
      }catch{return {}} // missing sensors dont mean the phone is disconnected
    }
    if(d.mode==='roboscape'){
      // remembered IDs stays listed so is alive checks the robot heartbeat
      const alive=await this.rpc('RoboScape','send',{robot:d.remoteDeviceId,command:'is alive'})
      if(alive!==true&&alive!=='true')throw new ApiError(502,'Robot heartbeat expired.')
      const range=await this.rpc('RoboScape','send',{robot:d.remoteDeviceId,command:'get range'})
      const value=typeof range==='number'?range:Number(range)
      if(!Number.isFinite(value))throw new ApiError(502,'Robot did not return a range sample.')
      let vitals:Readings={}
      if(d.telemetryServiceName)try{vitals=await this.iotReadings(d.telemetryServiceName,d.remoteDeviceId)}catch{}
      return {...vitals,range:{value,unit:'mm'}}
    }
    await this.verify(d)
    return this.iotReadings(d.serviceName,d.remoteDeviceId)
  }
}

export function registerNetsBloxDevices(app:FastifyInstance,db:PrismaClient,hub:DeviceHub,owner:(r:FastifyRequest)=>Promise<string>,notify:()=>void,service:ClassroomService,client=new NetsBloxDevices(),provisioning?:DeviceProvisioning){
  const path='/api/sessions/:sessionId/netsblox-devices'
  const phoneClients=new Map<string,NetsBloxDevices>()
  const phoneKey=(sessionId:string,deviceId:string)=>`${sessionId}:${deviceId}`
  const transportFor=(sessionId:string,d:z.infer<typeof identity>)=>{
    if(d.mode!=='phoneiot')return client
    const connection=phoneClients.get(phoneKey(sessionId,d.remoteDeviceId))
    if(!connection)throw new ApiError(409,'Enter the PhoneIoT password again to reconnect this phone.')
    return connection
  }
  const phoneMethods=new Set(['authenticate','getAccelerometer','getGyroscope','getFacingDirection','getLightLevel','getPressure','getTemperature','getRelativeHumidity'])
  const execute=async(sessionId:string,r:{mode:string;serviceName:string|null;remoteDeviceId:string|null},body:z.infer<typeof deviceCommand>)=>{
    const d=identity.parse(r)
    if(body.transport==='iotscape'){
      if(d.mode!=='iotscape'||body.method!=='send')throw new ApiError(400,'Invalid IoTScape command transport.')
      const args=z.object({command:z.string().min(1).max(2000)}).strict().parse(body.args)
      return client.rpc('IoTScape','send',{service:d.serviceName,id:d.remoteDeviceId,command:args.command})
    }
    const methods=d.mode==='roboscape'?[{name:'send',args:['robot','command']}]:await client.methods(d.serviceName)
    if(d.mode==='phoneiot'&&!phoneMethods.has(body.method))throw new ApiError(400,'Select a supported PhoneIoT sensor RPC.')
    const method=methods.find(m=>m.name===body.method&&m.args[0]===(d.mode==='roboscape'?'robot':d.mode==='phoneiot'?'device':'id'))
    if(!method)throw new ApiError(400,'Select a device RPC exposed by this service.')
    if(Object.keys(body.args).some(k=>!method.args.slice(1).includes(k)))throw new ApiError(400,'Unexpected RPC argument.')
    if(d.mode==='roboscape'&&!/^(get range|get ticks|is alive|set speed -?\d+[, ]-?\d+|drive -?\d+[, ]-?\d+|beep \d+[, ]\d+|set led [01][, ][012])$/.test(String(body.args.command)))throw new ApiError(400,'Unsupported robot command.')
    try{return await transportFor(sessionId,d).rpc(d.serviceName,body.method,{...body.args,[method.args[0]]:d.remoteDeviceId})}catch(e){if(d.mode==='phoneiot')throw new ApiError(502,'PhoneIoT RPC failed. Check the phone connection, password and sensor availability.');throw e}
  }
  const controls=new DeviceControls(db,service,execute,async r=>{
    if(r.mode==='roboscape'){
      const result=await client.rpc('RoboScape','send',{robot:r.remoteDeviceId,command:'set speed 0 0'})
      if(result!==true&&result!=='true')throw new Error('Robot did not acknowledge stop')
    }
  },notify)
  const identification=new DeviceIdentification(async(id,jobId)=>{
    try{
      const message=await controls.identify(id,async(sessionId,r)=>{
        const d=identity.parse(r)
        const row=await db.sessionDevice.findUniqueOrThrow({where:{id},include:{device:true}})
        return signalDevice(transportFor(sessionId,d),d,row.device.name,jobId)
      })
      await db.$transaction(tx=>hub.event(tx,id,'DEVICE_IDENTIFIED',message));notify();return message
    }catch(e){
      const message=e instanceof Error?e.message:'Identification failed.'
      if(await db.sessionDevice.findUnique({where:{id}}))await db.$transaction(tx=>hub.event(tx,id,'DEVICE_IDENTIFICATION_FAILED',message))
      notify();throw e
    }
  },async id=>{await controls.identify(id,async()=>{})},notify)
  const identify=async(sessionId:string,id:string)=>{
    const row=await db.sessionDevice.findFirst({where:{id,sessionId},include:{device:true,runtime:true}})
    if(!row?.runtime?.remoteDeviceId||!['iotscape','roboscape','phoneiot'].includes(row.runtime.mode))throw new ApiError(409,'This device has no supported NetsBlox connection for identification.')
    return identification.schedule({id,sessionId,label:row.device.name+' ('+row.device.type+')',remoteDeviceId:row.runtime.remoteDeviceId})
  }
  app.get(`${path}/identifications`,async r=>({jobs:identification.list(await owner(r))}))
  app.post(`${path}/identifications/:jobId/cancel`,async r=>identification.cancel(await owner(r),z.string().uuid().parse((r.params as {jobId:string}).jobId)))
  app.post(`${path}/:id/identify`,async r=>identify(await owner(r),z.string().uuid().parse((r.params as {id:string}).id)))
  const studentToken=(r:FastifyRequest)=>{
    if(!r.headers.authorization?.startsWith('Bearer '))throw new ApiError(401,'A student token is required.')
    return z.string().min(32).max(128).parse(r.headers.authorization.slice(7))
  }
  const deviceId=(r:FastifyRequest)=>z.string().uuid().parse((r.params as {id:string}).id)
  const run=z.object({runId:z.string().uuid()})
  app.post('/api/student/devices/:id/command',async r=>{
    const body=deviceCommand.merge(run).parse(r.body)
    return controls.command(studentToken(r),deviceId(r),body.runId,body)
  })
  app.post('/api/student/devices/:id/renew',async r=>{
    const body=run.extend({leaseId:z.string().uuid()}).parse(r.body)
    return controls.renew(studentToken(r),deviceId(r),body.runId,body.leaseId)
  })
  app.post('/api/student/devices/finish',async r=>controls.finish(studentToken(r),run.parse(r.body).runId))
  app.post(`${path}/:id/release-control`,async r=>controls.forceRelease(await owner(r),deviceId(r)))
  app.get(path,async r=>{
    await owner(r)
    const q=z.object({mode:z.enum(['iotscape','roboscape']).default('iotscape'),serviceName:word.optional()}).parse(r.query)
    return {...await client.discover(q.mode,q.serviceName),servicesUrl:client.base}
  })
  const attachment=identity.extend({name:z.string().trim().min(1).max(100),type:z.enum(['Phone','Sensor','Robot','Other'])})
  const attach=async(sessionId:string,d:z.infer<typeof attachment>,connection=transportFor(sessionId,d))=>{
    await connection.verify(d)
    const telemetry=await connection.sample(d)
    const result=await hub.attach(sessionId,{...d,sourceId:`${d.mode}:${d.serviceName}:${d.remoteDeviceId}`,profile:'custom',model:d.mode==='roboscape'?'RoboScape robot':d.serviceName,manufacturer:'NetsBlox',capabilities:d.mode==='roboscape'?['Robot','Motors','Range Sensor']:[d.type==='Phone'?'Phone / Tablet':'Any Sensor',...Object.keys(telemetry).map(k=>({temperature:'Temperature Sensor',humidity:'Humidity Sensor',accelerationX:'Accelerometer',light:'Light Sensor'}[k]??k))].slice(0,20),telemetry,...(batteryPercentage(telemetry)!==null?{battery:batteryPercentage(telemetry)}:{}),sampledAt:new Date().toISOString()})
    notify();return {id:result.id}
  }
  app.post(path,async r=>{const sessionId=await owner(r),d=attachment.parse(r.body);if(d.mode==='phoneiot')throw new ApiError(400,'Use the PhoneIoT ID and password form.');return attach(sessionId,d)})
  app.post(`${path}/phoneiot`,async r=>{
    const sessionId=await owner(r)
    if((await db.session.findUniqueOrThrow({where:{id:sessionId}})).status!=='OPEN')throw new ApiError(409,'Reopen the classroom before connecting a phone.')
    const body=z.object({name:z.string().trim().min(1).max(100),remoteDeviceId:z.string().trim().min(1).max(128).transform(id=>id.toLowerCase()),password:z.string().min(1).max(128)}).strict().parse(r.body)
    const connection=client.fork(),d=attachment.parse({mode:'phoneiot',serviceName:'PhoneIoT',remoteDeviceId:body.remoteDeviceId,name:body.name,type:'Phone'})
    try{
      await connection.rpc('PhoneIoT','setCredentials',{device:d.remoteDeviceId,password:body.password})
      await connection.verify(d)
    }catch{throw new ApiError(502,'PhoneIoT could not authenticate the phone. Check its device ID and password, and tap Connect in the PhoneIoT app.')}
    const result=await attach(sessionId,d,connection)
    phoneClients.set(phoneKey(sessionId,d.remoteDeviceId),connection)
    return result
  })
  app.get(`${path}/connection-options`,async r=>{await owner(r);return {localDeviceTesting:!!provisioning}})
  app.get(`${path}/local`,async r=>{await owner(r);if(!provisioning)throw new ApiError(403,'Local simulator testing is disabled.');return {devices:provisioning.list()}})
  app.post(`${path}/local/:localId/connect`,async r=>{
    const sessionId=await owner(r)
    if(!provisioning)throw new ApiError(403,'Local simulator testing is disabled.')
    const localId=z.string().uuid().parse((r.params as {localId:string}).localId)
    if((await db.session.findUniqueOrThrow({where:{id:sessionId}})).status!=='OPEN')throw new ApiError(409,'Reopen the classroom before connecting a device.')
    const {name}=z.object({name:z.string().trim().min(1).max(100)}).parse(r.body)
    let d
    try{d=await provisioning.provision(localId,client.base)}catch(e){throw new ApiError(502,e instanceof Error?e.message:'Device registration failed.')}
    // give hosted discovery a moment since the device start its own native connection
    let failure:unknown
    for(let attempt=0;attempt<10;attempt++){
      try{return await attach(sessionId,attachment.parse({...d,name}))}catch(e){
        if(e instanceof ApiError&&e.statusCode!==502&&e.statusCode!==409)throw e
        if(e instanceof ApiError&&e.statusCode===409&&!e.message.includes('not available')&&!e.message.includes('offline'))throw e
        failure=e;if(attempt<9)await new Promise(resolve=>setTimeout(resolve,500))
      }
    }
    throw failure
  })

  const attached=async(r:FastifyRequest)=>{
    const sessionId=await owner(r),id=z.string().uuid().parse((r.params as {id:string}).id)
    const row=await db.deviceRuntime.findFirst({where:{sessionDeviceId:id,mode:{in:['iotscape','roboscape','phoneiot']},device:{sessionId}},include:{device:{include:{session:true}}}})
    if(!row)throw new ApiError(404,'NetsBlox device not found in this classroom.')
    if(row.device.session.status!=='OPEN')throw new ApiError(409,'Reopen the classroom first.')
    return {row,d:identity.parse({mode:row.mode,serviceName:row.serviceName,telemetryServiceName:row.telemetryServiceName,remoteDeviceId:row.remoteDeviceId})}
  }
  app.get(`${path}/:id/methods`,async r=>{const {d}=await attached(r);return d.mode==='roboscape'?[{name:'send',args:['command'],description:'RoboScape command: get range, get ticks, set speed left right, beep ms tone, set led led state.'}]:(await client.methods(d.serviceName)).filter(m=>d.mode==='phoneiot'?m.args[0]==='device'&&phoneMethods.has(m.name):m.args[0]==='id')})
  app.post(`${path}/:id/rpc`,async r=>{
    const {row,d}=await attached(r)
    const body=deviceCommand.parse(r.body)
    const result=await controls.teacherCommand(row.sessionDeviceId,body)
    await db.$transaction(tx=>hub.event(tx,row.sessionDeviceId,'DEVICE_COMMAND',`${d.serviceName}.${body.method} called.`))
    notify();return {result}
  })
  app.post(`${path}/:id/connection`,async r=>{
    const {row,d}=await attached(r),{connected}=z.object({connected:z.boolean()}).parse(r.body)
    if(connected)await transportFor(row.device.sessionId,d).verify(d)
    await service.transaction(async tx=>{
      if(connected)await hub.ensureNotConnected(tx,{...d,sessionId:row.device.sessionId,sourceId:`${d.mode}:${d.serviceName}:${d.remoteDeviceId}`})
      await tx.deviceRuntime.update({where:{sessionDeviceId:row.sessionDeviceId},data:{state:connected?'connected':'paused'}})
      await tx.sessionDevice.update({where:{id:row.sessionDeviceId},data:{status:connected?'ONLINE':'OFFLINE'}})
    })
    notify();return {ok:true}
  })
  let busy=false
  const poll=async()=>{
    if(busy)return;busy=true
    try{
      const rows=await db.deviceRuntime.findMany({where:{mode:{in:['iotscape','roboscape','phoneiot']},state:{not:'paused'},device:{session:{status:'OPEN'}}},include:{device:true}})
      await Promise.allSettled(rows.map(async row=>{
        const started=Date.now();let telemetry:Prisma.InputJsonValue|undefined,status:'ONLINE'|'OFFLINE'='ONLINE'
        const missingCredentials=row.mode==='phoneiot'&&!phoneClients.has(phoneKey(row.device.sessionId,row.remoteDeviceId??''))
        try{telemetry=await transportFor(row.device.sessionId,identity.parse({mode:row.mode,serviceName:row.serviceName,telemetryServiceName:row.telemetryServiceName,remoteDeviceId:row.remoteDeviceId})).sample(identity.parse({mode:row.mode,serviceName:row.serviceName,telemetryServiceName:row.telemetryServiceName,remoteDeviceId:row.remoteDeviceId}))}catch{status='OFFLINE'}
        await db.$transaction(async tx=>{
          // pending samples must not brings a removed or paused connection back
          await tx.$queryRaw`SELECT "sessionDeviceId" FROM "DeviceRuntime" WHERE "sessionDeviceId"=${row.sessionDeviceId}::uuid FOR UPDATE`
          const fresh=await tx.deviceRuntime.findUnique({where:{sessionDeviceId:row.sessionDeviceId},include:{device:{include:{session:true}}}})
          if(!fresh||fresh.state==='paused'||fresh.device.session.status!=='OPEN')return
          const state=missingCredentials?'credentials-required':status==='ONLINE'?'connected':'disconnected'
          await tx.deviceRuntime.update({where:{sessionDeviceId:row.sessionDeviceId},data:{state,...(telemetry?{telemetry,sampledAt:new Date()}:{})}})
          await tx.sessionDevice.update({where:{id:row.sessionDeviceId},data:{status,...(status==='ONLINE'?{lastSeenAt:new Date(),latencyMs:Date.now()-started,batteryLevel:telemetry?batteryPercentage(telemetry as Readings):null}:{})}})
          if(state!==fresh.state)await hub.event(tx,row.sessionDeviceId,status==='ONLINE'?'DEVICE_ONLINE':'DEVICE_OFFLINE',`${row.serviceName} ${state}.`)
        })
      }))
      const savedPhones=await db.deviceRuntime.findMany({where:{mode:'phoneiot'},include:{device:true}})
      const keys=new Set(savedPhones.map(p=>phoneKey(p.device.sessionId,p.remoteDeviceId??'')))
      for(const key of phoneClients.keys())if(!keys.has(key))phoneClients.delete(key)
      if(rows.length)notify()
      await db.sessionDevice.updateMany({where:{session:{status:'CLOSED'},runtime:{mode:{in:['iotscape','roboscape','phoneiot']}}},data:{status:'OFFLINE'}})
    }finally{busy=false}
  }
  const timer=setInterval(()=>void poll().catch(e=>app.log.error(e)),5000);timer.unref()
  let expiring=false
  const controlTimer=setInterval(()=>{if(!expiring){expiring=true;void controls.expire().catch(e=>app.log.error(e)).finally(()=>{expiring=false})}},2000);controlTimer.unref()
  app.addHook('onClose',async()=>{clearInterval(timer);clearInterval(controlTimer);phoneClients.clear();identification.close()})
  return {client,poll,controls,identify,identification}
}
