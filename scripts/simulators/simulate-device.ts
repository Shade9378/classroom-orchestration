import { fileURLToPath } from 'node:url'
import { simulatorIdentity, simulatorWasConnected, rememberSimulatorConnection } from './simulatorIdentity.js'
import {startIoTScape,startRoboScape} from './netsblox-simulators.js'
import {advertiseDevices} from '../../server/deviceProvisioning.js'
const args=process.argv.slice(2),arg=(key:string)=>args[args.indexOf(key)+1]
const base=(process.env.NETSBLOX_SERVICES_URL??'https://services.netsblox.org').replace(/\/$/,''),host=new URL(base).hostname
const six=args.includes('--six'),profile=args.includes('--profile')?arg('--profile'):'sht40'
const specs=six?[['galaxy-s23','Phone 1'],['galaxy-s23','Phone 2'],['sht40','Sensor 1'],['sht40','Sensor 2'],['roboscape','Robot 1'],['roboscape','Robot 2']]:[[profile,args.includes('--name')?arg('--name'):'Local device']]
if (six && args.includes('--device-id')) throw new Error('Use --device-id with a single simulator.')
const directory = fileURLToPath(new URL('../../.local/simulator-identities/', import.meta.url))
const devices = specs.map(([profile, name]) => simulatorIdentity({
  directory, servicesUrl: base, profile, name, namespace: process.env.SIMULATOR_NAMESPACE,
  deviceId: args.includes('--device-id') ? arg('--device-id') : undefined,
}))
const running:{stop:()=>void}[]=[]
let stopped=false
const panel=await advertiseDevices(devices,Number(process.env.DEVICE_PROVISIONING_PORT??41234),base,async d=>{
  const spec=devices.find(item=>item.id===d.id)!
  let port=Number(spec.mode==='roboscape'?process.env.ROBOSCAPE_PORT??1973:process.env.IOTSCAPE_PORT)
  if(spec.mode==='iotscape'&&!port){
    const r=await fetch(base+'/routes/iotscape/port',{signal:AbortSignal.timeout(8000)})
    if(!r.ok)throw new Error('Cannot discover the NetsBlox IoTScape port.')
    port=Number(await r.text())
  }
  if(stopped)throw new Error('Device is shutting down.')
  const onCommand=(method:string,params:unknown[])=>console.log(`${new Date().toISOString()} ${JSON.stringify({device:spec.name,service:spec.serviceName,deviceId:spec.remoteDeviceId,command:method,args:params})}`)
  const device=spec.mode==='roboscape'?await startRoboScape({host,port,id:spec.remoteDeviceId,name:spec.name,onCommand}):await startIoTScape({host,port,id:spec.remoteDeviceId,name:spec.name,service:spec.serviceName,profile:spec.profile,onCommand})
  const resources = [device]
  try {
    if (spec.mode === 'roboscape' && spec.telemetryServiceName) {
      let telemetryPort = Number(process.env.IOTSCAPE_PORT)
      if (!telemetryPort) {
        const response = await fetch(base + '/routes/iotscape/port', { signal: AbortSignal.timeout(8000) })
        if (!response.ok) throw new Error('Cannot discover IoTScape telemetry port')
        telemetryPort = Number(await response.text())
      }
      const telemetry = await startIoTScape({
        host, port: telemetryPort, id: spec.remoteDeviceId, name: spec.name, service: spec.telemetryServiceName,
        profile: 'roboscape-health', onCommand: (method, params) => console.log(new Date().toISOString() + ' ' + JSON.stringify({
          device: spec.name, service: spec.telemetryServiceName, command: method, args: params,
        })),
      })
      resources.push(telemetry)
    }
    rememberSimulatorConnection(directory, spec.id)
  } catch (error) {
    for (const resource of resources) resource.stop()
    throw error
  }
  running.push(...resources)
  console.log(spec.name + ': registered with ' + device.service + ' / ' + device.id)
})
const reconnecting = new Set(devices.filter(device => args.includes('--device-id') || simulatorWasConnected(directory, device.id)).map(device => device.id))
const resume = () => {
  for (const id of reconnecting) {
    void panel.resume(id).then(() => {
      reconnecting.delete(id)
      console.log(devices.find(device => device.id === id)!.name + ': connection resumed; the dashboard will detect it automatically')
    }).catch(error => {
      if (!stopped) console.error('Reconnect failed; retrying: ' + (error as Error).message)
    })
  }
}
const reconnectTimer = setInterval(resume, 5000)
const stop = async () => {
  if(stopped)return
  stopped = true
  clearInterval(reconnectTimer)
  await panel.stop()
  for (const device of running) device.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const device of devices) {
  console.log(device.name + ': ' + device.serviceName + ' / ' + device.remoteDeviceId
    + (reconnecting.has(device.id) ? '; resuming previous connection' : '; discoverable locally, waiting for teacher to connect'))
}
resume()
console.log('Connect new devices once from the dashboard. Previously connected devices resume automatically. Stop with Ctrl+C.')
