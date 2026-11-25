import dgram from 'node:dgram'
import {once} from 'node:events'
import {test,expect} from 'vitest'
import {startIoTScape,startRoboScape} from '../../scripts/simulators/netsblox-simulators.js'

async function receiver(){const socket=dgram.createSocket('udp4');socket.bind(0,'127.0.0.1');await once(socket,'listening');return socket}
test('IoTScape UDP announcement and named RPCs exchange sensor data and controls',async()=>{
  const server=await receiver(),port=(server.address() as {port:number}).port
  const commands:{method:string;params:unknown[]}[]=[],onCommand=(method:string,params:unknown[])=>{commands.push({method,params})}
  const announcement=once(server,'message')
  const device=await startIoTScape({host:'127.0.0.1',port,id:'sensor1',name:'Sensor 1',service:'ClassroomTestSensors',profile:'sht40',onCommand})
  try{
    const [bytes,remote]=await announcement,definition=JSON.parse(bytes.toString())
    expect(definition.ClassroomTestSensors.id).toBe('sensor1')
    expect(definition.ClassroomTestSensors.methods.setEnvironment.params.map((a:{name:string})=>a.name)).toEqual(['temperature','humidity'])
    const call=async(name:string,params:unknown[]=[])=>{
      const response=once(server,'message')
      server.send(JSON.stringify({id:42,service:device.service,device:device.id,function:name,params}),remote.port,remote.address)
      return JSON.parse((await response)[0].toString())
    }
    expect(definition.ClassroomTestSensors.methods.getBatteryLevel).toBeDefined()
    expect(definition.ClassroomTestSensors.methods.getHealth).toBeUndefined()
    expect(await call('setEnvironment',[30,60])).toEqual({request:42,response:[true]})
    expect(commands[0]).toEqual({method:'setEnvironment',params:[30,60]})
    expect(await call('getTemperature')).toEqual({request:42,response:[30]})
    const readings=(await call('getReadings')).response[0]
    expect(readings).toContainEqual(['humidity',60,'% RH'])
    expect(readings.some(([name]:[string])=>name==='health'||name==='charging'||name==='batteryHealth')).toBe(false)
    expect((await call('getBatteryLevel')).response[0]).toBeGreaterThan(0)
  }finally{device.stop();server.close()}
})
test('RoboScape simulator identifies itself and responds to native speed, ticks and range packets',async()=>{
  const server=await receiver(),port=(server.address() as {port:number}).port,announcement=once(server,'message')
  const commands:{method:string;params:unknown[]}[]=[],onCommand=(method:string,params:unknown[])=>{commands.push({method,params})}
  const robot=await startRoboScape({host:'127.0.0.1',port,id:'020000000001',name:'Robot',onCommand})
  try{
    const [hello,remote]=await announcement
    expect(hello.subarray(0,6).toString('hex')).toBe(robot.id);expect(hello.toString('ascii',10)).toBe('I')
    const call=async(command:Buffer)=>{const response=once(server,'message');server.send(command,remote.port,remote.address);return (await response)[0] as Buffer}
    const speed=Buffer.alloc(5);speed.write('S');speed.writeInt16LE(25,1);speed.writeInt16LE(-10,3)
    const ack=await call(speed);expect(ack.readInt16LE(11)).toBe(25);expect(ack.readInt16LE(13)).toBe(-10)
    expect(commands[0]).toEqual({method:'set speed',params:[25,-10]})
    const range=await call(Buffer.from('R'));expect(range.length).toBe(13);expect(range.readInt16LE(11)).toBeGreaterThan(0)
    const ticks=await call(Buffer.from('T'));expect(ticks.length).toBe(19)
    expect(commands.slice(-2)).toEqual([{method:'get range',params:[]},{method:'get ticks',params:[]}])
  }finally{robot.stop();server.close()}
})

test('robot companion exposes battery and health with the normal IoTScape protocol',async()=>{
  const server=await receiver(),port=(server.address() as {port:number}).port,announcement=once(server,'message')
  const telemetry=await startIoTScape({host:'127.0.0.1',port,id:'020000000001',name:'Robot 1',service:'ClassroomRobotHealth',profile:'roboscape-health'})
  try{
    const [bytes,remote]=await announcement,definition=JSON.parse(bytes.toString()).ClassroomRobotHealth
    expect(definition.methods.getBatteryLevel).toBeDefined();expect(definition.methods.setEnvironment).toBeUndefined()
    const response=once(server,'message')
    server.send(JSON.stringify({id:7,service:'ClassroomRobotHealth',device:telemetry.id,function:'getReadings',params:[]}),remote.port,remote.address)
    const rows=JSON.parse((await response)[0].toString()).response[0]
    expect(rows).toEqual([['batteryLevel',88,'%']])
  }finally{telemetry.stop();server.close()}
})
