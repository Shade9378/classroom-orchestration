import {test,expect} from 'vitest'
import {NetsBloxDevices} from '../../server/netsbloxDevices.js'
import {batteryPercentage,deviceVitalRows,deviceSensorReadings} from '../../src/devices/vitals.js'
function client(options:{named?:boolean;missing?:boolean}={}){
  return new NetsBloxDevices('http://vitals.test',(async(input:unknown)=>{
    const path=new URL(String(input)).pathname
    let value:unknown
    if(path==='/IoTScape/getDevices')value=['sensor1']
    else if(path==='/HealthSensors')value={rpcs:Object.fromEntries((options.named?['getBatteryLevel','getHealth']:['getReadings']).map(name=>[name,{args:[{name:'id'}]}]))}
    else if(path==='/HealthSensors/getReadings')value=[['batteryLevel',0,'%'],['health','critical',''],['batteryVoltage',3.1,'V']]
    else if(path==='/HealthSensors/getBatteryLevel')value=42
    else if(path==='/HealthSensors/getHealth')value='warning'
    else if(path==='/RoboScape/send')value=true
    else if(path==='/PhoneIoT/authenticate')value=true
    else if(path==='/PhoneIoT/getAccelerometer')value=[0,0,9.81]
    else return new Response('not found',{status:404})
    if(options.missing&&path.startsWith('/HealthSensors/get'))return new Response('unavailable',{status:500})
    return new Response(JSON.stringify(value))
  }) as typeof fetch)
}
test('IoTScape readings preserve 0% and reported hardware health',async()=>{
  const r=await client().sample({mode:'iotscape',serviceName:'HealthSensors',remoteDeviceId:'sensor1'})
  expect(batteryPercentage(r)).toBe(0)
  expect(deviceVitalRows(r)).toContainEqual(['Battery','0%'])
  expect(deviceVitalRows(r)).toEqual([['Battery','0%']])
  expect(deviceSensorReadings(r)).toEqual([])
})
test('named battery and health RPCs work without a getReadings method',async()=>{
  const r=await client({named:true}).sample({mode:'iotscape',serviceName:'HealthSensors',remoteDeviceId:'sensor1'})
  expect(r).toEqual({batteryLevel:{value:42,unit:'%'}})
  expect(await client({named:true,missing:true}).sample({mode:'iotscape',serviceName:'HealthSensors',remoteDeviceId:'sensor1'})).toEqual({})
})
test('RoboScape companion provides reported vitals and absent companion stays unavailable',async()=>{
  const d={mode:'roboscape' as const,serviceName:'RoboScape',remoteDeviceId:'020000000011'}
  const unsupported=await client().sample(d)
  expect(deviceVitalRows(unsupported)).toContainEqual(['Battery','Unavailable'])
  const r=await client().sample({...d,telemetryServiceName:'HealthSensors'})
  expect(r.batteryLevel.value).toBe(0);expect(r.health.value).toBe('critical')
})
test('PhoneIoT never guesses hardware health or battery from connection status',async()=>{
  const r=await client().sample({mode:'phoneiot',serviceName:'PhoneIoT',remoteDeviceId:'aabbccddeeff'})
  expect(deviceVitalRows(r).every(([,value])=>value==='Unavailable')).toBe(true)
  expect(batteryPercentage({batteryLevel:{value:150,unit:'%'}})).toBeNull()
  expect(batteryPercentage({batteryLevel:{value:'unknown',unit:'%'}})).toBeNull()
})
