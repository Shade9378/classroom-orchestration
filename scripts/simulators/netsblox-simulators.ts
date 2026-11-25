import {simulateVitals} from '../../src/devices/vitals.js'
import dgram from 'node:dgram'
import {randomBytes} from 'node:crypto'
import {simulateReadings,type SimControls} from '../../src/devices/profiles.js'
export type SimulatorOptions={host:string;port:number;id:string;name:string;service:string;profile:string;onCommand?:(method:string,params:unknown[])=>void}
async function socketFor(host:string,port:number){
  const socket=dgram.createSocket('udp4')
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.connect(port,host,()=>{socket.off('error',reject);resolve()})})
  socket.on('error',e=>console.error('NetsBlox UDP:',e.message));return socket
}
export async function startIoTScape(o:SimulatorOptions){
  const socket=await socketFor(o.host,o.port),started=Date.now(),controls:SimControls={}
  const method=(documentation:string,params:{name:string;type:string}[]=[],type='number')=>({documentation,params,returns:{type:[type]}})
  const phone=o.profile==='galaxy-s23',healthOnly=o.profile==='roboscape-health'
  const methods={getBatteryLevel:method('Simulated battery percentage.'),getReadings:method('Synthetic sensor readings as [name, value, unit] rows.',[],'array'),getTemperature:method('Temperature in Celsius.'),getHumidity:method('Relative humidity in percent.'),getAcceleration:method('Acceleration vector, m/s^2.',[],'array'),getProfile:method('Simulated device identity.',[],'string'),...(phone?{setVibration:method('Set simulated vibration.',[{name:'enabled',type:'boolean'}],'boolean')}:{setEnvironment:method('Set simulated temperature and humidity.',[{name:'temperature',type:'number'},{name:'humidity',type:'number'}],'boolean')})}
  if(phone){delete (methods as Record<string,unknown>).getTemperature;delete (methods as Record<string,unknown>).getHumidity}
  else delete (methods as Record<string,unknown>).getAcceleration
  if(healthOnly)for(const name of ['getTemperature','getHumidity','getAcceleration','setEnvironment'])delete (methods as Record<string,unknown>)[name]
  const definition={[o.service]:{id:o.id,service:{version:3,description:`Classroom ${phone?'phone':'sensor'} simulator. Synthetic data only.`},methods}}
  const announce=()=>socket.send(JSON.stringify(definition))
  socket.on('message',data=>{
    let r:{id:unknown;service:string;device:string;function:string;params:unknown[]}
    try{r=JSON.parse(data.toString())}catch{return}
    if(r.service!==o.service||r.device!==o.id||!Object.hasOwn(methods,r.function))return
    const seconds=(Date.now()-started)/1000,readings={...(healthOnly?{}:simulateReadings(o.profile,seconds,controls)),...simulateVitals(o.profile,seconds)}
    let value:unknown
    switch(r.function){
      case 'getProfile':value=JSON.stringify({name:o.name,type:healthOnly?'Robot':phone?'Phone':'Sensor',profile:o.profile,simulated:true});break
      case 'getBatteryLevel':value=readings.batteryLevel.value;break
      case 'getReadings':value=Object.entries(readings).map(([name,r])=>[name,r.value,r.unit]);break
      case 'getTemperature':value=readings.temperature?.value;break
      case 'getHumidity':value=readings.humidity?.value;break
      case 'getAcceleration':value=['accelerationX','accelerationY','accelerationZ'].map(k=>readings[k]?.value);break
      case 'setVibration':if(typeof r.params?.[0]!=='boolean')return;controls.vibrating=r.params[0];value=true;break
      case 'setEnvironment':{
        const [t,h]=r.params??[];if(typeof t!=='number'||typeof h!=='number'||!Number.isFinite(t)||!Number.isFinite(h)||t< -40||t>125||h<0||h>100)return
        controls.temperature=t;controls.humidity=h;value=true;break
      }
    }
    o.onCommand?.(r.function,Array.isArray(r.params)?r.params:[]);socket.send(JSON.stringify({request:r.id,response:[value]}))
  })
  announce();const timer=setInterval(announce,5000)
  return {id:o.id,service:o.service,stop:()=>{clearInterval(timer);socket.close()}}
}
export async function startRoboScape(o:Omit<SimulatorOptions,'service'|'profile'>){
  if(!/^[0-9a-f]{12}$/.test(o.id))throw new Error('Robot ID must be 12 lowercase hex characters.')
  const socket=await socketFor(o.host,o.port),started=Date.now();let left=0,right=0,leftTicks=0,rightTicks=0,last=started,lastDrive=started
  const frame=(command:string,payload=Buffer.alloc(0))=>{
    const head=Buffer.alloc(11);Buffer.from(o.id,'hex').copy(head);head.writeUInt32LE((Date.now()-started)>>>0,6);head.write(command,10)
    socket.send(Buffer.concat([head,payload]))
  }
  socket.on('message',data=>{
    const command=data.toString('ascii',0,1)
    const out=Buffer.from(data.subarray(1))
    if(command==='S'&&data.length===5){o.onCommand?.('set speed',[data.readInt16LE(1),data.readInt16LE(3)]);left=Math.max(-128,Math.min(128,data.readInt16LE(1)));right=Math.max(-128,Math.min(128,data.readInt16LE(3)));lastDrive=Date.now();frame(command,out)}
    else if(command==='D'&&data.length===5){o.onCommand?.('drive',[data.readInt16LE(1),data.readInt16LE(3)]);leftTicks+=data.readInt16LE(1);rightTicks+=data.readInt16LE(3);frame(command,out)}
    else if(command==='R'&&data.length===1){o.onCommand?.('get range',[]);const range=Buffer.alloc(2);range.writeInt16LE(Math.round(800+200*Math.sin((Date.now()-started)/10000)));frame('R',range)}
    else if(command==='T'&&data.length===1){o.onCommand?.('get ticks',[]);const ticks=Buffer.alloc(8);ticks.writeInt32LE(Math.round(leftTicks)|0,0);ticks.writeInt32LE(Math.round(rightTicks)|0,4);frame('T',ticks)}
    else if(command==='B'&&data.length===5){o.onCommand?.('beep',[data.readUInt16LE(1),data.readUInt16LE(3)]);frame(command,out)}
    else if(command==='L'&&data.length===3){o.onCommand?.('set led',[data[1],data[2]]);frame(command,out)}
    else if(command==='G'&&data.length===4){o.onCommand?.('infra light',[data.readUInt16LE(1),Math.round(100-data[3]/2.55)]);frame(command,out)}
    else if(command==='n'&&data.length===4){o.onCommand?.('show number',[data[1],data.readUInt16LE(2)]);frame(command,out)}
  })
  frame('I')
  const timer=setInterval(()=>{const now=Date.now(),delta=(now-last)/1000;last=now;if(now-lastDrive>5000){left=0;right=0}leftTicks+=left*delta;rightTicks+=right*delta;frame('I')},1000)
  return {id:o.id,service:'RoboScape',stop:()=>{clearInterval(timer);socket.close()}}
}
export const robotId=()=> '02'+randomBytes(5).toString('hex')
