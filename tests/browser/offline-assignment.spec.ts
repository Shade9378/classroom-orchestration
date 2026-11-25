import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('offline devices can be assigned from the resource pool and device details',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Offline teacher ${randomUUID()}`,password:'Offline device test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Offline assignment ${randomUUID()}`}})).json(),path=`/api/sessions/${session.id}`
 const groups=[]
 for(const name of ['Group 1','Group 2'])groups.push(await(await request.post(`${path}/groups`,{data:{name}})).json())
 const activity={id:randomUUID(),name:`Robot task ${randomUUID()}`,description:'',starterProject:'',requirements:[{id:randomUUID(),capability:'Robot',quantity:1}],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 await request.put(`/api/activities/${activity.id}`,{data:activity})
 await request.post(`${path}/assignments`,{data:{groupIds:groups.map(g=>g.id),kind:'activity',id:activity.id}})
 const device=await(await request.post(`${path}/devices`,{data:{name:'Offline robot',type:'Robot',capabilities:['Robot'],status:'OFFLINE'}})).json()
 const snapshot=async()=>await(await request.get(`/api/state?sessionId=${session.id}`)).json()
 await page.goto(`/?session=${session.id}`)
 await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
 await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
 await page.getByRole('button',{name:'Connect device',exact:true}).click()
 await expect(page.getByRole('dialog').getByRole('heading',{name:'Connect device',exact:true})).toBeVisible()
 await expect(page.getByLabel('Device source')).toBeVisible()
 await page.getByRole('button',{name:'Close device window',exact:true}).click()
 await page.getByRole('checkbox',{name:'Select Offline robot',exact:true}).check()
 await page.locator('input[name="resource-target"]').first().check()
 await page.getByRole('button',{name:'Assign 1 Devices to Group 1',exact:true}).click()
 await expect.poll(async()=>(await snapshot()).devices.find((d:any)=>d.id===device.id).assignedGroupId).toBe(groups[0].id)
 await page.locator('.resource-device-list').getByRole('button',{name:'View Offline robot details',exact:true}).click()
 await page.getByLabel('Device assigned group').selectOption(groups[1].id)
 await expect.poll(async()=>(await snapshot()).devices.find((d:any)=>d.id===device.id).assignedGroupId).toBe(groups[1].id)
 expect((await snapshot()).devices.find((d:any)=>d.id===device.id).status).toBe('offline')
 await page.getByRole('button',{name:'Close device window',exact:true}).click()
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await page.getByRole('button',{name:'Devices',exact:true}).click()
 await page.getByRole('button',{name:'Connect device',exact:true}).click()
 await expect(page.getByLabel('Device source')).toBeVisible()
})
