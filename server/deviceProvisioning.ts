import dgram from 'node:dgram'
import {randomBytes,randomUUID} from 'node:crypto'
import {z} from 'zod'

const text=z.string().min(1).max(100)
const device=z.object({id:z.string().uuid(),name:text,type:z.enum(['Phone','Sensor','Robot','Other']),mode:z.enum(['iotscape','roboscape']),serviceName:z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100),remoteDeviceId:text,telemetryServiceName:z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100).optional(),registered:z.boolean()})
export type ProvisionableDevice=z.infer<typeof device>
const beacon=z.object({kind:z.literal('classroom-device'),capability:z.string().length(64),devices:z.array(device).max(20)})
const connect=z.object({kind:z.literal('provision'),requestId:z.string().uuid(),id:z.string().uuid(),capability:z.string().length(64),servicesUrl:z.string().url().max(500)})
const reply=z.object({kind:z.literal('provisioned'),requestId:z.string().uuid(),ok:z.boolean(),error:z.string().max(250).optional()})

export class DeviceProvisioning {
  private socket=dgram.createSocket('udp4')
  private rows=new Map<string,{device:ProvisionableDevice;capability:string;port:number;seen:number}>()
  private pending=new Map<string,{port:number;resolve:()=>void;reject:(e:Error)=>void}>()
  private started=false
  async start(port=0){
    this.socket.on('message',(bytes,remote)=>{
      if(remote.address!=='127.0.0.1'||bytes.length>16000)return
      let value:unknown;try{value=JSON.parse(bytes.toString())}catch{return}
      const advertised=beacon.safeParse(value)
      if(advertised.success){
        const ids=new Set(advertised.data.devices.map(d=>d.id))
        for(const [id,row] of this.rows)if(row.port===remote.port&&row.capability===advertised.data.capability&&!ids.has(id))this.rows.delete(id)
        for(const d of advertised.data.devices){
          const previous=this.rows.get(d.id)
          if(previous&&Date.now()-previous.seen<7000&&(previous.port!==remote.port||previous.capability!==advertised.data.capability))continue
          this.rows.set(d.id,{device:d,capability:advertised.data.capability,port:remote.port,seen:Date.now()})
        }
        for(const [id,r] of this.rows)if(Date.now()-r.seen>30000)this.rows.delete(id)
        return
      }
      const response=reply.safeParse(value);if(!response.success)return
      const p=this.pending.get(response.data.requestId)
      if(p?.port===remote.port){if(response.data.ok)p.resolve();else p.reject(new Error(response.data.error??'Device registration failed.'))}
    })
    await new Promise<void>((resolve,reject)=>{this.socket.once('error',reject);this.socket.bind(port,'127.0.0.1',()=>{this.socket.off('error',reject);resolve()})})
    this.socket.on('error',()=>{});this.started=true
    return (this.socket.address() as {port:number}).port
  }
  get port(){return (this.socket.address() as {port:number}).port}
  list(){return [...this.rows.values()].filter(r=>Date.now()-r.seen<7000).map(r=>r.device)}
  async provision(id:string,servicesUrl:string){
    const row=this.rows.get(id)
    if(!row||Date.now()-row.seen>=7000)throw new Error('The device is no longer discoverable. Keep its program running and refresh.')
    const requestId=randomUUID(),packet=JSON.stringify({kind:'provision',requestId,id,servicesUrl,capability:row.capability})
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>done(new Error('The device did not complete NetsBlox registration. Try connecting again.')),12000)
      const resend=setInterval(()=>this.socket.send(packet,row.port,'127.0.0.1'),750)
      const done=(error?:Error)=>{clearTimeout(timer);clearInterval(resend);this.pending.delete(requestId);error?reject(error):resolve()}
      this.pending.set(requestId,{port:row.port,resolve:()=>done(),reject:done})
      this.socket.send(packet,row.port,'127.0.0.1')
    })
    return row.device
  }
  close(){for(const p of this.pending.values())p.reject(new Error('Device discovery stopped.'));if(this.started){this.started=false;this.socket.close()}}
}

export async function advertiseDevices(devices:Omit<ProvisionableDevice,'registered'>[],registryPort:number,servicesUrl:string,register:(device:Omit<ProvisionableDevice,'registered'>)=>Promise<void>){
  const socket=dgram.createSocket('udp4'),capability=randomBytes(32).toString('hex'),registered=new Set<string>(),inflight=new Map<string,Promise<void>>()
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',()=>{socket.off('error',reject);resolve()})})
  socket.on('error',()=>{})
  let stopped=false,stopping:Promise<void>|undefined
  const announce=()=>{if(stopped)return;socket.send(JSON.stringify({kind:'classroom-device',capability,devices:devices.map(d=>({...d,registered:registered.has(d.id)}))}),registryPort,'127.0.0.1')}
  const ensureRegistered = async (d: Omit<ProvisionableDevice, 'registered'>) => {
    if (registered.has(d.id)) return
    let task = inflight.get(d.id)
    if (!task) { task = register(d); inflight.set(d.id, task) }
    try { await task; registered.add(d.id) }
    finally { inflight.delete(d.id) }
  }
  socket.on('message',async(bytes,remote)=>{
    if(remote.address!=='127.0.0.1'||remote.port!==registryPort||bytes.length>2000)return
    let value:unknown;try{value=JSON.parse(bytes.toString())}catch{return}
    const parsed=connect.safeParse(value)
    if(!parsed.success||parsed.data.capability!==capability)return
    const r=parsed.data,d=devices.find(d=>d.id===r.id);if(!d)return
    let error:string|undefined
    try{
      if(r.servicesUrl.replace(/\/$/,'')!==servicesUrl.replace(/\/$/,''))throw new Error('Device and dashboard must use the same NetsBlox services host.')
      await ensureRegistered(d)
    }catch(e){error=(e instanceof Error?e.message:'Device registration failed.').slice(0,250)}
    if(stopped)return
    socket.send(JSON.stringify({kind:'provisioned',requestId:r.requestId,ok:!error,error}),remote.port,remote.address);announce()
  })
  announce();const timer=setInterval(announce,2000)
  return {
    stop: () => {
      if(stopping)return stopping
      stopped=true;clearInterval(timer)
      stopping=new Promise<void>(resolve=>socket.send(JSON.stringify({kind:'classroom-device',capability,devices:[]}),registryPort,'127.0.0.1',()=>socket.close(()=>resolve())))
      return stopping
    },
    resume: async (id: string) => {
      if(stopped)throw new Error('The local device program has stopped.')
      const d = devices.find(device => device.id === id)
      if (!d) throw new Error('Unknown local simulator.')
      await ensureRegistered(d)
      announce()
    },
  }
}
