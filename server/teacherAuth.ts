import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ApiError, hashToken } from './service.js'
const cookieName='classroom_teacher'
const lifetime=86400
const cookieToken=(request:FastifyRequest)=>request.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)
const loopback=(host:string)=>['localhost','127.0.0.1','[::1]','::1'].includes(host)
function checkOrigin(request:FastifyRequest) {
  const origin=request.headers.origin
  if(!origin)return
  let url:URL
  try{url=new URL(origin)}catch{throw new ApiError(403,'Invalid request origin.')}
  if(!['http:','https:'].includes(url.protocol)||!(url.hostname===request.hostname||(loopback(url.hostname)&&loopback(request.hostname))))throw new ApiError(403,'Teacher requests must come from this application.')
}
export async function registerTeacherAuth(app:FastifyInstance,db:PrismaClient,options:{onLogout?:()=>Promise<void>}={}) {
  const currentAccount=async(request:FastifyRequest)=>{
    checkOrigin(request)
    const token=cookieToken(request)
    if(!token||!/^[a-f0-9]{64}$/.test(token))return null
    return (await db.teacherLogin.findFirst({where:{tokenHash:hashToken(token),expiresAt:{gt:new Date()}},include:{account:true}}))?.account ?? null
  }
  const authenticated=async(request:FastifyRequest)=>!!(await currentAccount(request))
  const issue=async(reply:{header:(name:string,value:string)=>unknown},accountId:string,request:FastifyRequest)=>{
    const token=randomBytes(32).toString('hex')
    await db.teacherLogin.create({data:{tokenHash:hashToken(token),accountId,expiresAt:new Date(Date.now()+lifetime*1000)}})
    reply.header('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${lifetime}${request.protocol==='https'?'; Secure':''}`)
    const account=await db.teacherAccount.findUniqueOrThrow({where:{id:accountId}})
    return {authenticated:true,name:account.name}
  }
  app.get('/api/teacher/status',async request=>{
    const account=await currentAccount(request)
    return {authenticated:!!account,name:account?.name ?? null}
  })
  app.post('/api/teacher/register',async(request,reply)=>{
    checkOrigin(request)
    const {name,password}=z.object({name:z.string().trim().min(1).max(100),password:z.string().min(8).max(128)}).parse(request.body)
    const nameKey=name.toLowerCase()
    const salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(password,salt,64).toString('hex')
    try {
      const account=await db.teacherAccount.create({data:{id:randomUUID(),name,nameKey,salt,passwordHash}})
      return issue(reply,account.id,request)
    } catch(error) {
      if(error && typeof error==='object' && 'code' in error && error.code==='P2002')throw new ApiError(409,'A teacher with this name already exists. Log in or choose another name.')
      throw error
    }
  })
  app.post('/api/teacher/login',async(request,reply)=>{
    checkOrigin(request)
    const {name,password}=z.object({name:z.string().trim().min(1).max(100),password:z.string().min(1).max(128)}).parse(request.body)
    const account=await db.teacherAccount.findUnique({where:{nameKey:name.toLowerCase()}})
    // unknown names still gets the same password derivation work
    const supplied=scryptSync(password,account?.salt ?? 'unknown-teacher',64)
    if(!account||!timingSafeEqual(supplied,Buffer.from(account.passwordHash,'hex')))throw new ApiError(401,'Incorrect teacher name or password.')
    return issue(reply,account.id,request)
  })
  app.post('/api/teacher/logout',async(request,reply)=>{
    checkOrigin(request)
    if(await currentAccount(request))await options.onLogout?.()
    const token=cookieToken(request)
    if(token)await db.teacherLogin.deleteMany({where:{tokenHash:hashToken(token)}})
    reply.header('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`)
    return {ok:true}
  })
  return {authenticated,currentAccount}
}
