import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test.use({hasTouch:true})
for(const [width,height] of [[360,800],[390,844],[768,1024],[1024,768]])test(`dashboard fits and works on a ${width}px touch screen`,async({page})=>{
 await page.setViewportSize({width,height})
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Responsive teacher ${randomUUID()}`,password:'Responsive test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Demonstration classroom ${randomUUID()}`}})).json(),path=`/api/sessions/${session.id}`
 const a={id:randomUUID(),name:`A longer robot lesson ${randomUUID()}`,description:'Activity instructions to explore the classroom. '.repeat(8),starterProject:'',requirements:[{id:randomUUID(),capability:'Robot (RoboScape)',quantity:1}],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 const b={...a,id:randomUUID(),name:`Another lesson ${randomUUID()}`,requirements:[]}
 for(const activity of [a,b])await request.put(`/api/activities/${activity.id}`,{data:activity})
 const p={id:randomUUID(),name:`A longer classroom playlist ${randomUUID()}`,description:a.description,activityIds:[a.id,b.id]}
 await request.put(`/api/playlists/${p.id}`,{data:p})
 const g=await(await request.post(`${path}/groups`,{data:{name:'Group 1'}})).json()
 await request.post(`${path}/assignments`,{data:{groupIds:[g.id],kind:'playlist',id:p.id}})
 for(const name of ['Alex Taylor','Jordan Lee']){const student=await(await request.post('/api/participants/join',{data:{joinCode:session.joinCode,name:name+' '+randomUUID()}})).json();await request.post(`${path}/memberships`,{data:{groupId:g.id,participantIds:[student.participantId]}})}
 await request.post(`${path}/devices`,{data:{name:'Classroom demonstration robot',type:'Robot',capabilities:['Robot'],status:'OFFLINE'}})
 const navigate=async(name:string)=>{
  await page.getByRole('button',{name:'Open navigation menu',exact:true}).tap()
  await expect(page.getByRole('navigation',{name:'Primary navigation'})).toBeVisible()
  await page.getByRole('button',{name,exact:true}).tap()
  await expect(page.getByRole('navigation',{name:'Primary navigation'})).toBeHidden()
 }
 const fits=async(label:string)=>{
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))
  expect(dimensions.scroll,`${label}: horizontal overflow`).toBeLessThanOrEqual(dimensions.width+1)
  await page.screenshot({path:test.info().outputPath(`${label}.png`),fullPage:true})
 }
 await page.goto(`/?session=${session.id}`)
 await expect(page.getByRole('heading',{name:'Edit Activity',exact:true})).toBeVisible()
 await fits('activities')
 await page.getByRole('button',{name:'Playlists',exact:true}).tap()
 await page.locator('.playlist-card').filter({hasText:p.name}).tap()
 await page.getByRole('button',{name:`Move ${a.name} down`,exact:true}).tap()
 await expect(page.locator('.playlist-edit-row').first()).toContainText(b.name)
 await page.getByRole('button',{name:`Move ${a.name} up`,exact:true}).tap()
 await expect(page.locator('.playlist-edit-row').first()).toContainText(a.name)
 await expect(page.getByRole('button',{name:'Save Playlist',exact:true})).toBeDisabled()
 if(width<=700){
  const list=page.locator('.playlist-edit-list')
  expect(await list.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1)
 }
 await fits('playlists')
 await navigate('Group Assignments')
 await expect(page.getByRole('heading',{name:'Assign Activities / Playlists',exact:true})).toBeVisible()
 await fits('group-assignments')
 await page.getByRole('button',{name:'Resource Allocation',exact:true}).tap()
 await expect(page.getByRole('heading',{name:'Assign Devices',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Hardware Assignment Preview & Readiness',exact:true})).toBeVisible()
 await fits('resources')
 await page.getByRole('button',{name:'Connect device',exact:true}).tap()
 await expect(page.getByLabel('Device source')).toBeVisible()
 await fits('connect-device')
 await page.getByRole('button',{name:'Close device window',exact:true}).tap()
 await navigate('Live Classroom')
 await fits('live-classroom')
 await page.getByRole('button',{name:'Devices',exact:true}).tap()
 await fits('device-overview')
 await page.goto('/student')
 await expect(page.getByRole('button',{name:'Join class',exact:true})).toBeVisible()
 await fits('student-join')
 await page.getByLabel('Class code',{exact:true}).fill(session.joinCode)
 await page.getByLabel('Your name',{exact:true}).fill('Touch student '+randomUUID())
 await page.getByRole('button',{name:'Join class',exact:true}).tap()
 await expect(page.getByRole('button',{name:'Leave class',exact:true})).toBeVisible()
 await fits('student-classroom')
})
