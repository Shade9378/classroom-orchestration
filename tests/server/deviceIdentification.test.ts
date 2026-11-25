import {expect,test,vi} from 'vitest'
import {DeviceIdentification,signalDevice} from '../../server/deviceIdentification.js'

test('identification waits ten seconds, deduplicates requests and supports cancellation',async()=>{
  vi.useFakeTimers()
  const signal=vi.fn(async()=> 'Beep acknowledged.'),ready=vi.fn(async()=>{})
  const queue=new DeviceIdentification(signal,ready,()=>{})
  const device={id:'robot',sessionId:'class',label:'Robot (Robot)',remoteDeviceId:'abc'}
  try{
    const job=await queue.schedule(device)
    expect((await queue.schedule(device)).id).toBe(job.id)
    await vi.advanceTimersByTimeAsync(9999);expect(signal).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1);expect(signal).toHaveBeenCalledTimes(1)
    expect(queue.list('class')[0]).toMatchObject({state:'success',message:'Beep acknowledged.'})
    expect(queue.list('other')).toEqual([])
    const next=await queue.schedule(device);queue.cancel('class',next.id)
    await vi.advanceTimersByTimeAsync(10000);expect(signal).toHaveBeenCalledTimes(1)
    expect(queue.list('class')[1].state).toBe('cancelled')
  }finally{queue.close();vi.useRealTimers()}
})
test('a command beginning during the countdown is reported and not retried automatically',async()=>{
  vi.useFakeTimers();const signal=vi.fn(async()=>{throw Error('A command is running on this device. Try again when it finishes.')})
  const queue=new DeviceIdentification(signal,async()=>{},()=>{})
  try{await queue.schedule({id:'r',sessionId:'c',label:'Robot',remoteDeviceId:'r'});await vi.advanceTimersByTimeAsync(10000);expect(queue.list('c')[0]).toMatchObject({state:'error',message:expect.stringContaining('command is running')});await vi.advanceTimersByTimeAsync(10000);expect(signal).toHaveBeenCalledTimes(1)}finally{queue.close();vi.useRealTimers()}
})
test('robots prefer sound and fall back to an LED without movement',async()=>{
  const rpc=vi.fn(async(_s:string,_m:string,args:unknown)=>{if((args as {command:string}).command.startsWith('beep'))throw Error('no buzzer');return true})
  const result=await signalDevice({rpc,methods:async()=>[]},{mode:'roboscape',serviceName:'RoboScape',remoteDeviceId:'r'},'Robot','job')
  expect(result).toContain('LED');expect(rpc.mock.calls.map(c=>(c[2] as {command:string}).command)).toEqual(['beep 1000 880','set led 0 1','set led 0 0'])
})
test('PhoneIoT vibration falls back to a label without clearing student controls',async()=>{
  const methods=async()=>[{name:'vibrate',args:['device','durations','strength']},{name:'addLabel',args:['device','x','y','text','options']}]
  const rpc=vi.fn(async(_s:string,m:string)=>{if(m==='vibrate')throw Error('no vibration');return 'label'})
  expect(await signalDevice({rpc,methods},{mode:'phoneiot',serviceName:'PhoneIoT',remoteDeviceId:'p'},'Phone','job')).toContain('label')
  expect(rpc.mock.calls.map(c=>c[1])).toEqual(['vibrate','addLabel'])
})
test('IoTScape uses only exposed signals with known arguments and reports unsupported devices',async()=>{
  const rpc=vi.fn(async()=>true),device={mode:'iotscape',serviceName:'Sensor',remoteDeviceId:'id'}
  await expect(signalDevice({rpc,methods:async()=>[{name:'drive',args:['id','speed']},{name:'beep',args:['id','unknown']} ]},device,'Sensor','job')).rejects.toThrow('No supported identification signal')
  expect(rpc).not.toHaveBeenCalled()
  expect(await signalDevice({rpc,methods:async()=>[{name:'blink',args:['id']}]},device,'Sensor','job')).toContain('Light')
})
