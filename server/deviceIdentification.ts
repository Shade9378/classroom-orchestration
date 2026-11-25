import { randomUUID } from 'node:crypto'
import { ApiError } from './service.js'

export type Identification = { id:string; deviceId:string; label:string; remoteDeviceId:string; sessionId:string; dueAt:number; state:'scheduled'|'running'|'success'|'error'|'cancelled'; message:string; finishedAt?:number }
export class DeviceIdentification {
  private jobs=new Map<string,Identification>()
  private timers=new Map<string,ReturnType<typeof setTimeout>>()
  constructor(private signal:(deviceId:string,jobId:string)=>Promise<string>,private ready:(deviceId:string)=>Promise<void>,private changed:()=>void){}
  list(sessionId:string){
    for(const [id,job] of this.jobs)if(job.finishedAt&&job.finishedAt+60000<Date.now())this.jobs.delete(id)
    return [...this.jobs.values()].filter(job=>job.sessionId===sessionId)
  }
  async schedule(device:{id:string;sessionId:string;label:string;remoteDeviceId:string}){
    const current=[...this.jobs.values()].find(j=>j.deviceId===device.id&&['scheduled','running'].includes(j.state))
    if(current)return current
    await this.ready(device.id)
    const duplicate=[...this.jobs.values()].find(j=>j.deviceId===device.id&&['scheduled','running'].includes(j.state))
    if(duplicate)return duplicate
    const job:Identification={id:randomUUID(),deviceId:device.id,label:device.label,remoteDeviceId:device.remoteDeviceId,sessionId:device.sessionId,dueAt:Date.now()+10000,state:'scheduled',message:'Identification starts after the countdown.'}
    this.jobs.set(job.id,job)
    const timer=setTimeout(()=>{this.timers.delete(job.id);void this.run(job)},10000);timer.unref();this.timers.set(job.id,timer)
    this.changed();return job
  }
  private async run(job:Identification){
    if(job.state!=='scheduled')return
    job.state='running';job.message='Contacting device...';this.changed()
    try{job.message=await this.signal(job.deviceId,job.id);job.state='success'}catch(e){job.state='error';job.message=e instanceof Error?e.message:'Identification failed.'}
    job.finishedAt=Date.now();this.changed()
  }
  cancel(sessionId:string,id:string){
    const job=this.jobs.get(id)
    if(!job||job.sessionId!==sessionId)throw new ApiError(404,'Identification not found.')
    if(job.state==='running')throw new ApiError(409,'The identification command is already running.')
    clearTimeout(this.timers.get(id));this.timers.delete(id)
    if(job.state==='scheduled'){job.state='cancelled';job.message='Identification cancelled.';job.finishedAt=Date.now()}else this.jobs.delete(id)
    this.changed();return {ok:true}
  }
  close(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.jobs.clear()}
}

type Client={methods:(service:string)=>Promise<{name:string;args:string[]}[]>;rpc:(service:string,method:string,args:unknown)=>Promise<unknown>}
export async function signalDevice(client:Client,device:{mode:string;serviceName:string;remoteDeviceId:string},label:string,jobId:string){
  const attempt=async(method:string,args:unknown)=>{const result=await client.rpc(device.serviceName,method,args);if(result===false||result==='false'||result===null||result===undefined||(typeof result==='string'&&/error|not found|unsupported|not supported|unknown command|offline|timeout/i.test(result)))throw new Error('Device did not acknowledge identification.');return result}
  if(device.mode==='roboscape'){
    try{await attempt('send',{robot:device.remoteDeviceId,command:'beep 1000 880'});return 'Beep acknowledged. Listen for a one-second tone.'}catch{}
    try{
      await attempt('send',{robot:device.remoteDeviceId,command:'set led 0 1'})
      await new Promise(resolve=>setTimeout(resolve,600))
      await attempt('send',{robot:device.remoteDeviceId,command:'set led 0 0'})
      return 'LED signal acknowledged. Look for the brief light change.'
    }catch{}
    throw new ApiError(502,'Could not signal this robot. It may be offline or lack a working buzzer and LED. Check device ID '+device.remoteDeviceId+'.')
  }
  const methods=await client.methods(device.serviceName)
  const plans=device.mode==='phoneiot'?[
    {name:'vibrate',args:{device:device.remoteDeviceId,durations:[0.6,0.3,0.6],strength:100},message:'Vibration acknowledged. Feel for two pulses.'},
    {name:'addLabel',args:{device:device.remoteDeviceId,x:5,y:5,text:'Identify: '+label.slice(0,32),options:{id:'classroom-identify-'+jobId,fontSize:2}},message:'Identification label displayed in the PhoneIoT app.'},
  ]:[
    {name:'identify',args:{id:device.remoteDeviceId,duration:1,message:'Identify: '+label},message:'Identification signal acknowledged.'},
    {name:'beep',args:{id:device.remoteDeviceId,duration:1,frequency:880},message:'Sound signal acknowledged.'},
    {name:'vibrate',args:{id:device.remoteDeviceId,duration:1,strength:100},message:'Vibration signal acknowledged.'},
    {name:'blink',args:{id:device.remoteDeviceId,duration:1},message:'Light signal acknowledged.'},
    {name:'notify',args:{id:device.remoteDeviceId,message:'Identify: '+label},message:'Device notification acknowledged.'},
  ]
  for(const plan of plans){
    const method=methods.find(m=>m.name===plan.name&&m.args[0]===(device.mode==='phoneiot'?'device':'id'))
    const args=plan.args as Record<string,unknown>
    if(!method||method.args.some(key=>!(key in args)))continue
    try{await attempt(plan.name,Object.fromEntries(method.args.map(key=>[key,args[key]])));return plan.message}catch{}
  }
  throw new ApiError(502,'No supported identification signal succeeded. The device may be offline or have no exposed sound, vibration, light or display. Check device ID '+device.remoteDeviceId+'.')
}
