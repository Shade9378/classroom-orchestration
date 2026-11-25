import {access} from 'node:fs/promises'
import {join} from 'node:path'
import type {FastifyInstance} from 'fastify'
import fastifyStatic from '@fastify/static'

export async function registerFrontend(app:FastifyInstance,root:string){
  await access(join(root,'index.html'))
  await app.register(fastifyStatic,{root,maxAge:0})
  for(const path of ['/student','/student/'])app.get(path,async(_request,reply)=>reply.sendFile('index.html'))
}
