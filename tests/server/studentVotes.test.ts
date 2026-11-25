import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {beforeAll,afterAll,test,expect} from 'vitest'
import {buildApp} from '../../server/app.js'
if(!new URL(process.env.DATABASE_URL!).searchParams.get('schema')?.startsWith('test_'))throw Error('Use the isolated test database.')
const db=new PrismaClient(),live=await buildApp(db,{presenceIntervalMs:3600000})
beforeAll(()=>live.app.ready())
afterAll(async()=>{await live.app.close();await db.$disconnect()})
async function classroom(){
 const c=await live.service.createSession('Votes '+randomUUID()),group=await live.service.createGroup(c.session.id,'Group 1')
 const students=await Promise.all(['A','B'].map(name=>live.service.join(c.session.joinCode,name+randomUUID())))
 await live.service.moveStudents(c.session.id,group.id,students.map(s=>s.participantId))
 const activities=[0,1].map(n=>({id:randomUUID(),name:'Vote exercise '+n+' '+randomUUID(),description:'',starterProject:'',estimatedMinutes:10,requirements:[],completionMethod:'student' as const}))
 for(const a of activities)await live.service.saveActivity(a)
 const playlist={id:randomUUID(),name:'Vote playlist '+randomUUID(),description:'',activityIds:activities.map(a=>a.id)}
 await live.service.savePlaylist(playlist);await live.service.assignWork(c.session.id,[group.id],'playlist',playlist.id)
 const progressId=(await live.service.studentState(students[0].token)).activity!.progressId
 return {c,group,students,activities,progressId}
}
test('every member must agree; duplicate votes and concurrent last votes cannot skip work',async()=>{
 const {c,group,students,activities,progressId}=await classroom()
 await live.service.finishStudentActivity(students[0].token,progressId)
 await live.service.finishStudentActivity(students[0].token,progressId)
 expect(await db.groupCompletionVote.count({where:{progressId}})).toBe(1)
 for(const s of students)expect((await live.service.studentState(s.token)).activity).toMatchObject({id:activities[0].id,completionVote:{agreed:1,total:2,hasVoted:s===students[0]}})
 expect((await live.service.state(c.session.id)).groups[0].progress[0]).toMatchObject({completionVotes:1,requiredVotes:2})
 await live.service.finishStudentActivity(students[1].token,progressId)
 const next=(await live.service.studentState(students[0].token)).activity!
 expect(next.id).toBe(activities[1].id);expect(next.completionVote?.agreed).toBe(0)
 await Promise.all(students.map(s=>live.service.finishStudentActivity(s.token,next.progressId)))
 expect((await live.service.studentState(students[0].token)).finishedAssignedWork).toBe(true)
 expect(await db.systemEvent.count({where:{groupId:group.id,type:'ACTIVITY_COMPLETED'}})).toBe(2)
})
test('offline members still count and teachers can override incomplete votes',async()=>{
 const {c,group,students,activities,progressId}=await classroom()
 await live.service.leaveStudent(students[1].token)
 await live.service.finishStudentActivity(students[0].token,progressId)
 expect((await live.service.studentState(students[0].token)).activity).toMatchObject({id:activities[0].id,completionVote:{agreed:1,total:2}})
 await live.service.reviewActivity(c.session.id,group.id,progressId,'complete')
 expect((await live.service.studentState(students[0].token)).activity?.id).toBe(activities[1].id)
})
test('moving members clears their vote; same-group assignment preserves it and removing a pending member rechecks agreement',async()=>{
 const {c,group,students,activities,progressId}=await classroom()
 await live.service.finishStudentActivity(students[0].token,progressId)
 await live.service.moveStudents(c.session.id,group.id,[students[0].participantId])
 expect(await db.groupCompletionVote.count({where:{progressId}})).toBe(1)
 const other=await live.service.createGroup(c.session.id,'Other')
 await live.service.moveStudents(c.session.id,other.id,[students[0].participantId])
 expect(await db.groupCompletionVote.count({where:{progressId}})).toBe(0)
 await live.service.moveStudents(c.session.id,group.id,[students[0].participantId])
 await live.service.finishStudentActivity(students[0].token,progressId)
 await live.service.unassignStudents(c.session.id,[students[1].participantId])
 expect((await live.service.studentState(students[0].token)).activity?.id).toBe(activities[1].id)
})
test('new members require their own vote and outsiders cannot vote',async()=>{
 const {c,group,students,progressId}=await classroom()
 await live.service.finishStudentActivity(students[0].token,progressId)
 const third=await live.service.join(c.session.joinCode,'New member '+randomUUID())
 await expect(live.service.finishStudentActivity(third.token,progressId)).rejects.toThrow('Join an active classroom group')
 await live.service.moveStudents(c.session.id,group.id,[third.participantId])
 await live.service.finishStudentActivity(students[1].token,progressId)
 expect((await live.service.studentState(third.token)).activity?.completionVote).toMatchObject({agreed:2,total:3,hasVoted:false})
 await live.service.finishStudentActivity(third.token,progressId)
 expect((await live.service.studentState(third.token)).activity?.progressId).not.toBe(progressId)
})
