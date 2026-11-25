import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {PrismaClient} from '@prisma/client'
import {afterAll,beforeAll,expect,test} from 'vitest'
import {WebSocket} from 'ws'
import {buildApp} from '../../server/app.js'
const schema=new URL(process.env.DATABASE_URL!).searchParams.get('schema')
if(!schema?.startsWith('test_'))throw new Error('Use the isolated test database')
const db=new PrismaClient()
let root:string,live:Awaited<ReturnType<typeof buildApp>>
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'classroom-production-'))
  await mkdir(join(root,'assets'))
  await writeFile(join(root,'index.html'),'<!doctype html><title>Classroom production</title><div id="root"></div>')
  await writeFile(join(root,'assets/app.js'),'window.classroomLoaded=true')
  await writeFile(join(root,'student-editor.html'),'<!doctype html><title>Student editor</title>')
  live=await buildApp(db,{frontendRoot:root,trustProxy:true,presenceIntervalMs:3600000})
  await live.app.ready()
})
afterAll(async()=>{await live?.app.close();await db.$disconnect();if(root)await rm(root,{recursive:true,force:true})})
test('one production server serves both interfaces and assets without exposing source or swallowing API errors',async()=>{
  for(const url of ['/','/student','/student/','/student?class=ABC123']){
    const response=await live.app.inject(url)
    expect(response.statusCode,url).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('Classroom production')
  }
  expect((await live.app.inject('/assets/app.js')).body).toContain('classroomLoaded')
  expect((await live.app.inject('/student-editor.html')).body).toContain('Student editor')
  for(const url of ['/.env','/server/index.ts','/prisma/schema.prisma','/api/unknown','/rpc/unknown']){
    const response=await live.app.inject(url)
    expect(response.statusCode,url).toBe(404)
    expect(response.body).not.toContain('Classroom production')
  }
  expect((await live.app.inject('/api/health')).json()).toEqual({ok:true})
  expect((await live.app.inject('/rpc/Classroom')).json().name).toBe('Classroom')
})
test('HTTPS proxy login sets a secure cookie and the same host supports teacher WebSockets',async()=>{
  const headers={host:'internal:10000',origin:'https://classroom.onrender.com','x-forwarded-host':'classroom.onrender.com','x-forwarded-proto':'https'}
  const register=await live.app.inject({method:'POST',url:'/api/teacher/register',headers,payload:{name:'Hosted teacher '+randomUUID(),password:'Hosted test password'}})
  expect(register.statusCode,register.body).toBe(200)
  const cookie=String(register.headers['set-cookie'])
  expect(cookie).toContain('; Secure')
  expect(cookie).toContain('HttpOnly')
  const authHeaders={...headers,cookie:cookie.split(';')[0]}
  expect((await live.app.inject({url:'/api/teacher/status',headers:authHeaders})).json().authenticated).toBe(true)
  const address=await live.app.listen({host:'127.0.0.1',port:0})
  const socket=new WebSocket(address.replace('http:','ws:')+'/api/live',{headers:authHeaders})
  try{
    const ready=new Promise<unknown>((resolve,reject)=>{socket.once('message',message=>resolve(JSON.parse(message.toString())));socket.once('error',reject)})
    await once(socket,'open')
    socket.send(JSON.stringify({teacher:true}))
    expect(await ready).toEqual({type:'ready'})
  }finally{socket.terminate()}
  const foreign=await live.app.inject({method:'POST',url:'/api/teacher/login',headers:{...headers,origin:'https://unrelated.example'},payload:{name:'Nobody',password:'test'}})
  expect(foreign.statusCode).toBe(403)
})
test.skipIf(!existsSync('build/server/index.js'))('compiled production entry honors PORT and serves the built student application',async()=>{
  const probe=createServer()
  probe.listen(0,'127.0.0.1');await once(probe,'listening')
  const port=(probe.address() as {port:number}).port
  await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
  let output='',child:ChildProcess|undefined
  try{
    child=spawn(process.execPath,['build/server/index.js'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',PORT:String(port),API_PORT:'1',API_HOST:'127.0.0.1',TRUST_PROXY:'true',LOCAL_DEVICE_TESTING:'false'},stdio:['ignore','pipe','pipe']})
    child.stdout?.on('data',data=>{output+=data});child.stderr?.on('data',data=>{output+=data})
    await expect.poll(async()=>{
      if(child!.exitCode!==null)throw new Error(output)
      try{return (await fetch('http://127.0.0.1:'+port+'/api/health')).status}catch{return 0}
    }).toBe(200)
    const base='http://127.0.0.1:'+port
    for(const path of ['/','/student','/student/']){
      const response=await fetch(base+path)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<div id="root"></div>')
    }
    expect((await fetch(base+'/student-editor.html')).status).toBe(200)
    expect((await fetch(base+'/.env')).status).toBe(404)
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}
  }
})
