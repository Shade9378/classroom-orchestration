window.installClassroomDeviceControls=function(ide,emit,parentOrigin,isEnabled){
  const original=Process.prototype.callRPC,pending=new Map();let active=null,lastRenew=0
  const config=()=>{try{return JSON.parse(window.externalVariables?.classroom?.devices||'[]')}catch{return []}}
  const catalog=()=>{try{return JSON.parse(window.externalVariables?.classroom?.deviceServiceCatalog||'[]')}catch{return []}}
  const finish=()=>{if(active){const run=active;active=null;emit({type:'classroom-device-finish',runId:run.id})}}
  Process.prototype.callRPC=function(baseUrl,params,noCache){
    if(this.classroomDeviceRequest){
      const request=this.classroomDeviceRequest
      if(request.done){this.classroomDeviceRequest=null;if(request.error)throw new Error(request.error);return JSON.stringify(request.result??'')}
      if(this.readyToTerminate){this.classroomDeviceRequest=null;return}
      this.pushContext('doYield');this.pushContext();return
    }
    const parts=new URL(baseUrl,ide.services.defaultHost.url).pathname.split('/').filter(Boolean).map(decodeURIComponent)
    let [service,method]=parts.slice(-2),args=params,transport='native'
    if(typeof args==='string')args=Object.fromEntries(new URLSearchParams(args))
    args={...(args||{})}
    if(service==='IoTScape'&&method==='send'){service=args.service;transport='iotscape';delete args.service}
    if((service==='RoboScape'&&method==='getRobots')||(service==='PhoneIoT'&&['getSensors','getColor'].includes(method)))return original.call(this,baseUrl,params,noCache)
    const managed=['RoboScape','PhoneIoT',...catalog()].includes(service)
    if(!managed)return original.call(this,baseUrl,params,noCache)
    if(!isEnabled())throw new Error('Reconnect your classroom editor before controlling a device')
    const targetId=args.robot??args.device??args.id
    const device=config().find(d=>d.service===service&&(service==='RoboScape'||service==='PhoneIoT'?String(d.deviceId).toLowerCase()===String(targetId).toLowerCase():String(d.deviceId)===String(targetId)))
    if(!device)throw new Error('This device is not assigned to your current group')
    if(service==='PhoneIoT'&&method==='setCredentials')throw new Error('Phone credentials are managed by your teacher in the dashboard')
    delete args.id;delete args.robot;delete args.device
    if(!active)active={id:crypto.randomUUID(),processes:new Set()}
    active.processes.add(this)
    const id=crypto.randomUUID(),request={done:false,result:null,error:null}
    pending.set(id,request);this.classroomDeviceRequest=request
    const timer=setTimeout(()=>{if(pending.delete(id)){request.done=true;request.error='Classroom device request timed out'}},30000)
    request.timer=timer
    emit({type:'classroom-device-command',id,runId:active.id,deviceId:device.id,method,args,transport})
    this.pushContext('doYield');this.pushContext()
  }
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==parentOrigin)return
    const d=event.data
    if(d?.type==='classroom-device-result'){
      const request=pending.get(d.id)
      if(request){clearTimeout(request.timer);pending.delete(d.id);request.done=true;request.result=d.result;request.error=d.error}
    }else if(d?.type==='classroom-device-stop'){
      ide.stopAllScripts();finish();if(d.message)ide.showMessage(d.message,5)
    }
  })
  setInterval(()=>{
    if(!active)return
    const running=ide.stage.threads.processes
    if(![...active.processes].some(p=>running.includes(p)&&!p.readyToTerminate)){finish();return}
    if(Date.now()-lastRenew>5000){lastRenew=Date.now();emit({type:'classroom-device-renew',runId:active.id})}
  },100)
  addEventListener('pagehide',finish)
  return {finish}
}
