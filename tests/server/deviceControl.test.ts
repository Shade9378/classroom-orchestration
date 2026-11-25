import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {beforeAll,afterAll,beforeEach,test,expect} from 'vitest'
import {buildApp} from '../../server/app.js'
import {NetsBloxDevices} from '../../server/netsbloxDevices.js'
const url=new URL(process.env.DATABASE_URL!)
if(!url.searchParams.get('schema')?.startsWith('test_'))throw new Error('Use the isolated test database')
const db=new PrismaClient(),robots=new Set<string>(),calls:string[]=[]
let clock=Date.now(),stopFails=false,commandFails=false,hold:Promise<void>|undefined,entered=false
const transport=(async(input:unknown,init?:RequestInit)=>{
  const u=new URL(String(input)),args=JSON.parse(String(init?.body??'{}'))
  if(u.pathname.endsWith('/getRobots'))return new Response(JSON.stringify([...robots]))
  if(u.pathname.endsWith('/send')){
    const command=String(args.command);calls.push(command)
    if(command==='set speed 0 0'&&stopFails)return new Response('offline',{status:500})
    if(command==='set speed 20 20'&&commandFails)throw new TypeError('Upstream connection dropped')
    if(command==='set speed 20 20'&&hold){entered=true;await hold}
    return new Response(JSON.stringify(command==='get range'?850:true))
  }
  return new Response('not found',{status:404})
}) as typeof fetch
const live=await buildApp(db,{now:()=>new Date(clock),presenceIntervalMs:3600000,netsbloxDevices:new NetsBloxDevices('http://control.test',transport)})
beforeAll(()=>live.app.ready())
beforeEach(async()=>{await db.deviceControl.deleteMany();await db.deviceRun.deleteMany();calls.length=0;stopFails=false;commandFails=false;hold=undefined;entered=false})
afterAll(async()=>{await db.deviceControl.deleteMany();await live.app.close();await db.$disconnect()})
async function classroom(robot=randomUUID().replaceAll('-','').slice(0,12)){
  robots.add(robot)
  const c=await live.service.createSession('Control '+randomUUID()),g=await live.service.createGroup(c.session.id,'Drivers')
  const a=await live.service.join(c.session.joinCode,'Driver A '+randomUUID()),b=await live.service.join(c.session.joinCode,'Driver B '+randomUUID())
  await live.service.moveStudents(c.session.id,g.id,[a.participantId,b.participantId])
  const response=await live.app.inject({method:'POST',url:`/api/sessions/${c.session.id}/netsblox-devices`,headers:{'x-teacher-token':c.teacherToken},payload:{mode:'roboscape',serviceName:'RoboScape',remoteDeviceId:robot,name:'Robot',type:'Robot'}})
  expect(response.statusCode).toBe(200)
  const id=response.json().id as string;await live.service.assignDevices(c.session.id,g.id,[id]);calls.length=0
  return {c,g,a,b,id,robot}
}
const command=(token:string,id:string,runId:string,cmd='set speed 20 20')=>live.app.inject({method:'POST',url:`/api/student/devices/${id}/command`,headers:{authorization:`Bearer ${token}`},payload:{runId,method:'send',args:{command:cmd}}})
const finish=(token:string,runId:string)=>live.app.inject({method:'POST',url:'/api/student/devices/finish',headers:{authorization:`Bearer ${token}`},payload:{runId}})
test('simultaneous students get one owner; finish stops the robot before another student controls it',async()=>{
  const {c,a,b,id}=await classroom(),ra=randomUUID(),rb=randomUUID()
  const results=await Promise.all([command(a.token,id,ra),command(b.token,id,rb)])
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect(calls.filter(c=>c==='set speed 20 20')).toHaveLength(1)
  const winner=results[0].statusCode===200?a:b,loser=winner===a?b:a,run=winner===a?ra:rb
  expect((await live.service.studentState(loser.token)).devices[0].control?.name).toBe(winner.name)
  const headers={'x-teacher-token':c.teacherToken}
  expect((await live.app.inject({method:'POST',url:`/api/sessions/${c.session.id}/netsblox-devices/${id}/rpc`,headers,payload:{method:'send',args:{command:'set speed 50 50'}}})).statusCode).toBe(409)
  expect((await finish(winner.token,run)).statusCode).toBe(200)
  expect(calls.at(-1)).toBe('set speed 0 0')
  expect((await command(winner.token,id,run)).statusCode).toBe(409)
  expect((await command(loser.token,id,randomUUID(),'set speed 30 30')).statusCode).toBe(200)
  expect(calls.slice(-2)).toEqual(['set speed 0 0','set speed 30 30'])
})
test('assignment and presence checks reject outsiders, release moved students, and expire abandoned runs',async()=>{
  const {c,g,a,b,id}=await classroom(),run=randomUUID()
  const outsider=await live.service.join(c.session.joinCode,'Outsider '+randomUUID())
  expect((await command(outsider.token,id,randomUUID())).statusCode).toBe(403)
  expect((await command(a.token,id,run)).statusCode).toBe(200)
  await live.service.unassignStudents(c.session.id,[a.participantId]);await live.netsbloxDevices.controls.expire()
  expect(calls.at(-1)).toBe('set speed 0 0');expect(await db.deviceControl.count()).toBe(0)
  const next=randomUUID();expect((await command(b.token,id,next)).statusCode).toBe(200)
  clock+=91000;await live.service.heartbeat(b.token)
  await live.netsbloxDevices.controls.expire();expect(await db.deviceControl.count()).toBe(0)
  await live.service.moveStudents(c.session.id,g.id,[a.participantId]);await live.service.heartbeat(a.token)
  expect((await command(a.token,id,randomUUID())).statusCode).toBe(200)
  await live.service.leaveStudent(a.token);await live.netsbloxDevices.controls.expire()
  expect(await db.deviceControl.count()).toBe(0)
})
test('finish fences a not-yet-arrived command, and force release prevents the same run reacquiring',async()=>{
  const {c,a,id}=await classroom(),stopped=randomUUID()
  expect((await finish(a.token,stopped)).statusCode).toBe(200)
  expect((await command(a.token,id,stopped)).statusCode).toBe(409);expect(calls).toHaveLength(0)
  const run=randomUUID();expect((await command(a.token,id,run)).statusCode).toBe(200)
  expect((await live.app.inject({method:'POST',url:`/api/sessions/${c.session.id}/netsblox-devices/${id}/release-control`,headers:{'x-teacher-token':c.teacherToken},payload:{}})).statusCode).toBe(200)
  expect((await command(a.token,id,run)).statusCode).toBe(409)
  expect((await command(a.token,id,randomUUID())).statusCode).toBe(200)
})
test('in-flight RPC holds the gate until it returns, then finishing sends stop before a new owner',async()=>{
  const {a,b,id}=await classroom(),run=randomUUID();let resume!:()=>void
  hold=new Promise<void>(resolve=>{resume=resolve})
  const first=command(a.token,id,run);await expect.poll(()=>entered).toBe(true)
  let finished=false;const ending=finish(a.token,run).then(r=>{finished=true;return r})
  await new Promise(resolve=>setTimeout(resolve,30));expect(finished).toBe(false)
  expect(calls.filter(c=>c==='set speed 0 0')).toHaveLength(0)
  resume();expect((await first).statusCode).toBe(200);expect((await ending).statusCode).toBe(200)
  hold=undefined;expect((await command(b.token,id,randomUUID(),'set speed 30 30')).statusCode).toBe(200)
  expect(calls.slice(-3)).toEqual(['set speed 20 20','set speed 0 0','set speed 30 30'])
})
test('failed robot stop keeps control reserved and the same physical device is exclusive across classrooms',async()=>{
  const one=await classroom()
  await live.service.setSessionStatus(one.c.session.id,'CLOSED')
  const two=await classroom(one.robot),run=randomUUID()
  await live.service.setSessionStatus(one.c.session.id,'OPEN')
  await live.service.heartbeat(one.a.token);await live.service.heartbeat(one.b.token)
  await db.sessionDevice.update({where:{id:one.id},data:{status:'ONLINE'}})
  await db.deviceRuntime.update({where:{sessionDeviceId:one.id},data:{state:'connected'}})
  expect((await command(one.a.token,one.id,run)).statusCode).toBe(200)
  expect((await command(two.a.token,two.id,randomUUID())).statusCode).toBe(409)
  stopFails=true;expect((await finish(one.a.token,run)).statusCode).toBe(503)
  expect(await db.deviceControl.count()).toBe(1)
  expect((await command(one.b.token,one.id,randomUUID())).statusCode).toBe(503)
  stopFails=false;expect((await finish(one.a.token,run)).statusCode).toBe(200)
  expect((await command(two.a.token,two.id,randomUUID())).statusCode).toBe(200)
})

test('unassign stops current control, preserves the device and rejects foreign classroom batches',async()=>{
  const {c,a,b,id,g}=await classroom(),other=await classroom(),run=randomUUID()
  expect((await command(a.token,id,run)).statusCode).toBe(200)
  const remove=(deviceIds:string[],token?:string)=>live.app.inject({method:'DELETE',url:`/api/sessions/${c.session.id}/device-assignments`,headers:token?{'x-teacher-token':token}:{},payload:{deviceIds}})
  expect((await remove([id])).statusCode).toBe(403)
  expect((await remove([id,other.id],c.teacherToken)).statusCode).toBe(404)
  expect((await live.service.state(c.session.id)).devices[0].assignedGroupId).toBe(g.id)
  expect(await db.deviceControl.count()).toBe(1)
  expect((await live.app.inject({method:'DELETE',url:`/api/sessions/${other.c.session.id}/device-assignments`,headers:{'x-teacher-token':other.c.teacherToken},payload:{deviceIds:[other.id]}})).statusCode).toBe(200)
  expect(await db.deviceControl.count()).toBe(1)
  expect((await remove([id],c.teacherToken)).statusCode).toBe(200)
  expect(calls.at(-1)).toBe('set speed 0 0')
  const state=await live.service.state(c.session.id)
  expect(state.devices).toHaveLength(1);expect(state.devices[0].assignedGroupId).toBeUndefined();expect(state.devices[0].status).toBe('online')
  expect(state.groups[0].deviceIds).not.toContain(id)
  expect((await live.service.studentState(b.token)).devices).toHaveLength(0)
  expect((await command(a.token,id,randomUUID())).statusCode).toBe(403)
  expect(await db.deviceControl.count()).toBe(0)
  await live.service.assignDevices(c.session.id,g.id,[id]);await db.sessionDevice.update({where:{id},data:{status:'OFFLINE'}})
  expect((await remove([id],c.teacherToken)).statusCode).toBe(200)
  expect((await live.service.state(c.session.id)).devices[0].status).toBe('offline')
})

test('identify rejects active student control and in-flight commands instead of interrupting them',async()=>{
  const {c,a,id}=await classroom(),run=randomUUID()
  const path=`/api/sessions/${c.session.id}/netsblox-devices/${id}/identify`,headers={'x-teacher-token':c.teacherToken}
  expect((await live.app.inject({method:'POST',url:path})).statusCode).toBe(403)
  expect((await command(a.token,id,run)).statusCode).toBe(200)
  const busy=await live.app.inject({method:'POST',url:path,headers})
  expect(busy.statusCode).toBe(409);expect(busy.json().message).toContain('command is running')
  await finish(a.token,run)
  let release!:()=>void
  hold=new Promise<void>(resolve=>{release=resolve})
  const pending=command(a.token,id,randomUUID())
  try{
    await expect.poll(()=>entered).toBe(true)
    expect((await live.app.inject({method:'POST',url:path,headers})).statusCode).toBe(409)
  }finally{release();await pending;hold=undefined}
  expect(calls.filter(c=>c.startsWith('beep'))).toHaveLength(0)
})

test('identify can be requested for an offline unassigned device and manual disconnection cancels execution',async()=>{
  const {c,id}=await classroom()
  await live.service.unassignDevices(c.session.id,[id])
  await db.sessionDevice.update({where:{id},data:{status:'OFFLINE'}})
  const headers={'x-teacher-token':c.teacherToken},path=`/api/sessions/${c.session.id}/netsblox-devices`
  const scheduled=await live.app.inject({method:'POST',url:path+'/'+id+'/identify',headers})
  expect(scheduled.statusCode).toBe(200)
  expect(scheduled.json()).toMatchObject({deviceId:id,state:'scheduled'})
  const list=await live.app.inject({url:path+'/identifications',headers})
  expect(list.json().jobs).toContainEqual(expect.objectContaining({id:scheduled.json().id}))
  await live.app.inject({method:'POST',url:path+'/identifications/'+scheduled.json().id+'/cancel',headers})
  await db.deviceRuntime.update({where:{sessionDeviceId:id},data:{state:'paused'}})
  expect((await live.app.inject({method:'POST',url:path+'/'+id+'/identify',headers})).statusCode).toBe(409)
  expect(calls.filter(c=>c.startsWith('beep'))).toHaveLength(0)
})


test('lost upstream command replies preserve exclusive control until a confirmed stop',async()=>{
  const {a,b,id}=await classroom(),run=randomUUID()
  commandFails=true
  const failed=await command(a.token,id,run)
  expect(failed.statusCode).toBe(502)
  expect(failed.json().message).toContain('Upstream connection dropped')
  expect(await db.deviceControl.count()).toBe(1)
  expect((await command(b.token,id,randomUUID())).statusCode).toBe(409)
  expect(calls.filter(c=>c==='set speed 20 20')).toHaveLength(1)
  stopFails=true
  expect((await finish(a.token,run)).statusCode).toBe(503)
  expect(await db.deviceControl.count()).toBe(1)
  expect((await command(b.token,id,randomUUID())).statusCode).toBe(503)
  commandFails=false;stopFails=false
  expect((await finish(a.token,run)).statusCode).toBe(200)
  expect(calls.at(-1)).toBe('set speed 0 0')
  expect(await db.deviceControl.count()).toBe(0)
  expect((await command(b.token,id,randomUUID())).statusCode).toBe(200)
})
