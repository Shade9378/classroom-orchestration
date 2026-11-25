import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {expect,test} from 'vitest'
import {buildApp} from '../../server/app.js'
import {NetsBloxDevices} from '../../server/netsbloxDevices.js'
if(!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_'))throw Error('Use the isolated test database.')

test('duplicate physical devices are rejected even with different names and concurrent connection attempts',async()=>{
  const db=new PrismaClient(),remoteId=randomUUID().replaceAll('-','').slice(0,12)
  const transport=(async(input:unknown,init?:RequestInit)=>{
    const path=new URL(String(input)).pathname,args=JSON.parse(String(init?.body??'{}'))
    const value=path.endsWith('/getRobots')?[remoteId]:args.command==='get range'?700:true
    return new Response(JSON.stringify(value))
  }) as typeof fetch
  const live=await buildApp(db,{netsbloxDevices:new NetsBloxDevices('http://duplicates.test',transport)})
  try{
    const a=await live.service.createSession('Duplicate A '+randomUUID()),b=await live.service.createSession('Duplicate B '+randomUUID())
    const path=(id:string)=>'/api/sessions/'+id+'/netsblox-devices'
    const connect=(c:typeof a,name:string)=>live.app.inject({method:'POST',url:path(c.session.id),headers:{'x-teacher-token':c.teacherToken},payload:{mode:'roboscape',serviceName:'RoboScape',remoteDeviceId:remoteId,name,type:'Robot'}})
    const results=await Promise.all([connect(a,'First name'),connect(a,'Second name')])
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409])
    const id=results.find(r=>r.statusCode===200)!.json().id
    const original=await db.sessionDevice.findUniqueOrThrow({where:{id},include:{device:true}})
    const duplicate=await connect(a,'Renamed duplicate')
    expect(duplicate.statusCode).toBe(409);expect(duplicate.json().message).toContain('already connected')
    expect((await db.device.findUniqueOrThrow({where:{id:original.deviceId}})).name).toBe(original.device.name)
    expect((await connect(b,'Another classroom robot')).statusCode).toBe(409)
    expect(await db.sessionDevice.count({where:{sessionId:a.session.id}})).toBe(1)
    expect(await db.sessionDevice.count({where:{sessionId:b.session.id}})).toBe(0)
    await db.sessionDevice.update({where:{id},data:{status:'OFFLINE'}})
    await db.deviceRuntime.update({where:{sessionDeviceId:id},data:{state:'disconnected'}})
    const reconnected=await connect(a,original.device.name)
    expect(reconnected.statusCode).toBe(200);expect(reconnected.json().id).toBe(id)
    expect(await db.sessionDevice.count({where:{sessionId:a.session.id}})).toBe(1)
    const connection=await live.app.inject({method:'POST',url:path(a.session.id)+'/'+id+'/connection',headers:{'x-teacher-token':a.teacherToken},payload:{connected:true}})
    expect(connection.statusCode).toBe(409)
    await live.service.setSessionStatus(a.session.id,'CLOSED')
    expect((await connect(b,'New classroom robot')).statusCode).toBe(200)
    await live.service.setSessionStatus(a.session.id,'OPEN')
    expect(await db.deviceRuntime.findUnique({where:{sessionDeviceId:id}})).toMatchObject({state:'paused'})
    expect(await db.sessionDevice.findUnique({where:{id}})).toMatchObject({status:'OFFLINE'})
    await live.netsbloxDevices.poll()
    expect(await db.sessionDevice.findUnique({where:{id}})).toMatchObject({status:'OFFLINE'})
  }finally{await live.app.close();await db.$disconnect()}
})
