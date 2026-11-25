import {randomUUID} from 'node:crypto'
import {expect,test,vi} from 'vitest'
import {DeviceProvisioning,advertiseDevices} from '../../server/deviceProvisioning.js'
test('stopped advertisers withdraw immediately and a same-ID restart becomes provisionable',async()=>{
 const registry=new DeviceProvisioning();await registry.start()
 const device={id:randomUUID(),name:'Restart sensor',type:'Sensor' as const,mode:'iotscape' as const,serviceName:'RestartSensor',remoteDeviceId:'same-id'}
 let advertiser=await advertiseDevices([device],registry.port,'http://native.test',async()=>{})
 try{
  await vi.waitFor(()=>expect(registry.list()).toHaveLength(1))
  await advertiser.stop()
  await vi.waitFor(()=>expect(registry.list()).toHaveLength(0))
  const register=vi.fn(async()=>{})
  advertiser=await advertiseDevices([device],registry.port,'http://native.test',register)
  await vi.waitFor(()=>expect(registry.list()).toHaveLength(1))
  await registry.provision(device.id,'http://native.test')
  expect(register).toHaveBeenCalledTimes(1)
  await advertiser.stop();await advertiser.stop()
  await vi.waitFor(()=>expect(registry.list()).toHaveLength(0))
 }finally{await advertiser.stop();registry.close()}
})
