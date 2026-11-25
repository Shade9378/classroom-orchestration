import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('live panels keep members and devices at the top and use flexible progress, chat and events',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Live teacher ${randomUUID()}`,password:'Live test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Live layout ${randomUUID()}`}})).json(),path=`/api/sessions/${session.id}`
 const group=await(await request.post(`${path}/groups`,{data:{name:'Group 1'}})).json()
 const activity={id:randomUUID(),name:'Current activity with instructions',description:'Read these instructions carefully. '.repeat(14),starterProject:'',requirements:[],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 await request.put(`/api/activities/${activity.id}`,{data:activity})
 await request.post(`${path}/assignments`,{data:{groupIds:[group.id],kind:'activity',id:activity.id}})
 await page.goto(`/?session=${session.id}`)
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await expect(page.locator('.current-activity')).toHaveCount(0)
 const top=page.locator('.live-detail-row.two')
 await expect(top.locator('.mini-card').first()).toContainText('Group Members')
 await expect(top.locator('.mini-card').last()).toContainText('Assigned Devices')
 const progress=(await page.locator('.progress-card').boundingBox())!,chat=(await page.locator('#group-chat').boundingBox())!,events=(await page.locator('.recent-events-card').boundingBox())!
 expect(Math.abs(progress.width-chat.width)).toBeLessThan(1)
 expect(Math.abs(progress.height-chat.height)).toBeLessThan(1)
 expect(Math.abs(events.height-chat.height)).toBeLessThan(1)
 const assigned=page.locator('.assigned-devices-card'),empty=assigned.locator('.empty-state'),mark=empty.locator('.empty-state-mark')
 const outer=(await empty.boundingBox())!,icon=(await mark.boundingBox())!
 expect(Math.abs(icon.x+icon.width/2-(outer.x+outer.width/2))).toBeLessThan(2)
 const center=await empty.evaluate(e=>getComputedStyle(e).justifyContent)
 expect(center).toBe('center')
})
