import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('viewer fills the card and its dot follows live sync status',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Viewer teacher ${randomUUID()}`,password:'Viewer test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Viewer ${randomUUID()}`}})).json(),path=`/api/sessions/${session.id}`
 const group=await(await request.post(`${path}/groups`,{data:{name:'Group 1'}})).json()
 let hasProject=false,available=true
 await page.route('**/student-editor.html',route=>route.fulfill({contentType:'text/html',body:`<script>window.addEventListener('message',event=>{if(event.data.id)parent.postMessage({type:'classroom-reply',id:event.data.id},'*')});parent.postMessage({type:'classroom-editor-ready'},'*')</script>`}))
 await page.route(`**/api/sessions/${session.id}/groups/${group.id}/editor?*`,route=>route.fulfill({status:available?200:503,json:available?{groupId:group.id,workspaceKey:'',starterXml:'<project/>',editor:hasProject?{revision:'version-1',xml:'<project/>',version:-1,actions:[]}:null}:{message:'Connection unavailable'}}))
 await page.goto(`/?session=${session.id}`)
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 const viewer=page.locator('.group-editor-viewer')
 await expect(viewer.getByRole('img',{name:'No live connection',exact:true})).toBeVisible()
 await expect(viewer.getByRole('status')).toContainText('Waiting for students')
 expect((await viewer.locator('iframe').boundingBox())!.height).toBeGreaterThanOrEqual(500)
 const sidebar=page.locator('.live-detail-stack')
 const top=(await sidebar.locator('.live-detail-row.two').boundingBox())!
 expect(top.height).toBeLessThanOrEqual(140)
 const flexible=await Promise.all(['.progress-card','#group-chat','.recent-events-card'].map(async selector=>(await sidebar.locator(selector).boundingBox())!))
 for(const card of flexible){expect(card.height).toBeGreaterThan(140);expect(Math.abs(card.height-flexible[0].height)).toBeLessThan(1)}
 const project=(await page.locator('.netsblox-card').boundingBox())!,details=(await sidebar.boundingBox())!
 expect(Math.abs(project.y+project.height-details.y-details.height)).toBeLessThan(2)
 const first=(await sidebar.locator('.live-detail-row.two').boundingBox())!,second=(await sidebar.locator('.progress-card').boundingBox())!
 expect(Math.abs(second.y-(first.y+first.height)-6)).toBeLessThan(2)
 for(const selector of ['.progress-card','.assigned-devices-card']){
  const card=sidebar.locator(selector),empty=card.locator('.empty-state'),icon=empty.locator('.empty-state-mark'),label=empty.locator('strong')
  const outer=(await empty.boundingBox())!,mark=(await icon.boundingBox())!,text=(await label.boundingBox())!
  expect(Math.abs(mark.x+mark.width/2-outer.x-outer.width/2)).toBeLessThan(2)
  expect(Math.abs((mark.y+text.y+text.height)/2-outer.y-outer.height/2)).toBeLessThan(8)
 }
 await page.screenshot({path:test.info().outputPath('sidebar-layout.png'),fullPage:true})
 hasProject=true
 await expect(viewer.getByRole('img',{name:'Live connection',exact:true})).toBeVisible()
 expect(await viewer.locator('.viewer-live-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(220, 38, 38)')
 available=false
 await expect(viewer.getByRole('status')).toContainText('Connection unavailable')
 await expect(viewer.getByRole('img',{name:'No live connection',exact:true})).toBeVisible()
 expect(await viewer.locator('.viewer-live-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(156, 163, 175)')
})
