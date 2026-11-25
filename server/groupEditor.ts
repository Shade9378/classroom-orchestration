import { randomUUID } from 'node:crypto'
import { starterProject } from '../src/student/starter.js'
import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { activeProgressStatuses, ApiError, ClassroomService } from './service.js'
const editTypes=new Set(['setStageSize','addSprite','removeSprite','renameSprite','toggleDraggable','duplicateSprite','importSprites','setRotationStyle','attachParts','detachParts','addSound','renameSound','removeSound','addCostume','renameCostume','removeCostume','updateCostume','addVariable','deleteVariable','addCustomBlock','deleteCustomBlock','deleteCustomBlocks','setCustomBlockType','updateBlockLabel','deleteBlockLabel','addBlock','replaceBlock','removeBlock','setBlockPosition','setBlocksPositions','moveBlock','importBlocks','setCommentText','setSelector','setBlockSpec','addListInput','removeListInput','ringify','unringify','toggleBoolean','setColorField','setField','addMessageType','deleteMessageType','batch'])
async function source(tx:Prisma.TransactionClient,groupId:string) {
  const progress=await tx.groupActivityProgress.findFirst({where:{assignment:{groupId},status:{in:activeProgressStatuses}},include:{activity:true},orderBy:{assignment:{assignedAt:'asc'}}})
  const workspaceKey=progress?.activity.id??''
  const xml=progress?.activity.starterProjectRef.trim()||starterProject
  if(!xml.startsWith('<'))throw new ApiError(422,'This starter contains only a filename. Ask your teacher to upload the NetsBlox XML file again and save the activity.')
  return {workspaceKey,starterXml:xml,awaitingReview:progress?.status==='SUBMITTED'}
}
export async function viewGroupEditor(db:PrismaClient,service:ClassroomService,sessionId:string,groupId:string,after:number,revision?:string) {
  return db.$transaction(async tx=>{
    await service.requireGroup(tx,sessionId,groupId)
    const selected=await source(tx,groupId)
    const saved=await tx.groupEditor.findUnique({where:{groupId_workspaceKey:{groupId,workspaceKey:selected.workspaceKey}}})
    const sameRevision=!!saved && saved.revision===revision
    const actions=saved ? await tx.groupEditorAction.findMany({where:{groupId,workspaceKey:selected.workspaceKey,version:{gt:sameRevision?after:-1}},orderBy:{version:'asc'}}) : []
    return {groupId,...selected,starterXml:sameRevision?'':selected.starterXml,editor:saved?{revision:saved.revision,xml:sameRevision?'':saved.xml,version:saved.version,actions}:null}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})
}
export async function resetGroupEditor(_db:PrismaClient,service:ClassroomService,sessionId:string,groupId:string) {
  return service.transaction(async tx=>{
    await service.requireGroup(tx,sessionId,groupId)
    const {workspaceKey,starterXml,awaitingReview}=await source(tx,groupId)
    if(awaitingReview)throw new ApiError(409,'Return the submitted exercise before resetting the editor.')
    const revision=randomUUID()
    await tx.groupEditorAction.deleteMany({where:{groupId,workspaceKey}})
    await tx.groupEditor.upsert({where:{groupId_workspaceKey:{groupId,workspaceKey}},create:{groupId,workspaceKey,revision,xml:starterXml},update:{revision,xml:starterXml,version:-1}})
    await tx.systemEvent.create({data:{sessionId,groupId,type:'EDITOR_RESET',message:'Shared editor reset to the activity starter.'}})
    return {ok:true}
  })
}
export async function registerGroupEditor(app:FastifyInstance,db:PrismaClient,service:ClassroomService) {
  const token=(headers:{authorization?:string})=>{
    if(!headers.authorization?.startsWith('Bearer '))throw new ApiError(401,'Join the classroom first.')
    return headers.authorization.slice(7)
  }
  const member=async(secret:string,tx:Prisma.TransactionClient)=>{
    const p=await service.student(secret,tx)
    if(!p.member)throw new ApiError(409,'Your teacher must assign a group first.')
    return p
  }
  app.get('/api/student/editor',async request=>{
    const {after,revision}=z.object({after:z.coerce.number().int().min(-1).default(-1),revision:z.string().uuid().optional()}).parse(request.query)
    return db.$transaction(async tx=>{
      const p=await member(token(request.headers),tx),groupId=p.member!.groupId
      const selected=await source(tx,groupId)
      const editor=await tx.groupEditor.findUnique({where:{groupId_workspaceKey:{groupId,workspaceKey:selected.workspaceKey}},include:{actions:{where:{version:{gt:after}},orderBy:{version:'asc'}}}})
      return {groupId,...selected,starterXml:revision?'':selected.starterXml,actor:p.id,editable:p.session.status==='OPEN'&&!selected.awaitingReview,editor:editor?{...editor,xml:editor.revision===revision?'':editor.xml}:null}
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})
  })
  app.post('/api/student/editor',async request=>{
    const {xml,groupId:requestedGroup,workspaceKey}=z.object({groupId:z.string().uuid(),workspaceKey:z.string().max(100),xml:z.string().min(1).max(750000)}).parse(request.body)
    if(!xml.includes('<project') && !xml.includes('<snapdata'))throw new ApiError(400,'Invalid NetsBlox project.')
    return service.transaction(async tx=>{
      const p=await member(token(request.headers),tx)
      if(p.session.status!=='OPEN')throw new ApiError(409,'The classroom session is closed.')
      const groupId=p.member!.groupId
      const selected=await source(tx,groupId)
      if(selected.awaitingReview)throw new ApiError(409,'This exercise is waiting for teacher review.')
      if(requestedGroup!==groupId || selected.workspaceKey!==workspaceKey)throw new ApiError(409,'The group or activity changed. Reconnect the editor.')
      await tx.groupEditor.upsert({where:{groupId_workspaceKey:{groupId,workspaceKey}},create:{groupId,workspaceKey,xml},update:{}})
      return {groupId}
    })
  })
  app.post('/api/student/editor/actions',async request=>{
    const {groupId,workspaceKey,revision,version,action}=z.object({groupId:z.string().uuid(),workspaceKey:z.string().max(100),revision:z.string().uuid(),version:z.number().int().min(-1),action:z.object({id:z.number().int(),type:z.string().regex(/^[a-z][a-zA-Z]{1,60}$/),time:z.number().int(),args:z.array(z.unknown())}).passthrough()}).parse(request.body)
    const validAction=(event:unknown):boolean=>{
      if(!event || typeof event!=='object')return false
      const a=event as {type?:string;args?:unknown[];isUserAction?:unknown}
      return !!a.type && editTypes.has(a.type) && Array.isArray(a.args) && !a.isUserAction && (a.type!=='batch'||a.args.every(validAction))
    }
    if(!validAction(action))throw new ApiError(400,'Unsupported shared edit.')
    if(JSON.stringify(action).length>250000)throw new ApiError(400,'This edit is too large.')
    return service.transaction(async tx=>{
      const p=await member(token(request.headers),tx)
      if(p.member!.groupId!==groupId)throw new ApiError(409,'Your group changed. Reconnect the shared editor.')
      if(p.session.status!=='OPEN')throw new ApiError(409,'The classroom session is closed.')
      const selected=await source(tx,groupId)
      if(selected.awaitingReview)throw new ApiError(409,'This exercise is waiting for teacher review.')
      if(selected.workspaceKey!==workspaceKey)throw new ApiError(409,'Your activity changed. Reconnect the editor.')
      if(action.id!==version+1)throw new ApiError(400,'Invalid edit sequence.')
      const changed=await tx.groupEditor.updateMany({where:{groupId,workspaceKey,revision,version},data:{version:{increment:1}}})
      if(!changed.count)throw new ApiError(409,'A teammate edited first. The latest change will appear; try your edit again.')
      const record=await tx.groupEditorAction.create({data:{groupId,workspaceKey,version:version+1,action:{...action,user:p.id,username:p.id} as Prisma.InputJsonValue}})
      return record
    })
  })
}
