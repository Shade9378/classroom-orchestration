import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
async function setup(page:Page,view='activities'){
  const tag=randomUUID()
  expect((await page.request.post('/api/teacher/register',{data:{name:'Network teacher '+tag,password:'Teacher test password'}})).ok()).toBe(true)
  const {session}=await(await page.request.post('/api/sessions',{data:{name:'Network class '+tag}})).json()
  const activity={id:randomUUID(),name:'Network exercise '+tag,description:'Original instructions',starterProject:'',requirements:[],completionMethod:'teacher',estimatedMinutes:10}
  expect((await page.request.put('/api/activities/'+activity.id,{data:activity})).ok()).toBe(true)
  await page.goto('/?view='+view+'&session='+session.id+'&activity='+activity.id)
  await expect(page.locator('.classroom-content')).toBeVisible()
  return {session,activity}
}
test('initial authentication outage offers a retry and recovers without a reload',async({page})=>{
  let down=true
  await page.route('**/api/teacher/status',route=>down?route.fulfill({status:503,contentType:'text/html',body:'<html>Proxy unavailable</html>'}):route.continue())
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('503')
  down=false
  await page.getByRole('button',{name:'Retry connection',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Name',exact:true})).toBeVisible()
})
test('failed saves preserve the draft and a successful retry clears the error',async({page})=>{
  const {activity}=await setup(page)
  let down=true
  await page.route('**/api/activities/'+activity.id,route=>route.request().method()==='PUT'&&down?route.fulfill({status:502,contentType:'text/html',body:'Bad gateway'}):route.continue())
  const description=page.locator('.activity-editor-fields .textarea-wrap textarea').first()
  await description.fill('Keep these unsaved instructions')
  const save=page.getByRole('button',{name:'Save Changes',exact:true})
  await save.click()
  await expect(page.locator('.api-error')).toContainText('502')
  await expect(description).toHaveValue('Keep these unsaved instructions')
  await expect(save).toBeEnabled()
  down=false
  await save.click()
  await expect(save).toBeDisabled()
  await expect(page.locator('.api-error')).toHaveCount(0)
  expect((await(await page.request.get('/api/state')).json()).activities.find((a:{id:string})=>a.id===activity.id).description).toBe('Keep these unsaved instructions')
})
test('committed group creation stays successful when its follow-up refresh fails',async({page})=>{
  const {session}=await setup(page,'groups')
  let readsDown=false,creates=0
  await page.route('**/api/sessions/'+session.id+'/groups',async route=>{
    creates++
    const response=await route.fetch()
    readsDown=true
    await route.fulfill({response})
  })
  await page.route('**/api/state**',route=>readsDown?route.fulfill({status:503,json:{message:'Refresh unavailable'}}):route.continue())
  await page.getByRole('button',{name:'New Group',exact:true}).first().click()
  await expect(page.getByRole('status').filter({hasText:'Group 1 created.'})).toBeVisible()
  await expect(page.locator('.api-error')).toContainText('saved')
  expect(creates).toBe(1)
  readsDown=false
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect(page.locator('.student-group-column .group-choice')).toContainText('Group 1')
  await expect(page.locator('.api-error')).toHaveCount(0)
  expect((await(await page.request.get('/api/state?sessionId='+session.id)).json()).groups).toHaveLength(1)
})
test('a hung save times out, releases the form, and keeps the unsaved draft',async({page})=>{
  const {activity}=await setup(page)
  await page.clock.install()
  let release=()=>{},intercepted=false
  const held=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/activities/'+activity.id,async route=>{
    if(route.request().method()!=='PUT')return route.continue()
    intercepted=true
    await held
    await route.abort().catch(()=>{})
  })
  try{
    const description=page.locator('.activity-editor-fields .textarea-wrap textarea').first()
    await description.fill('Not lost when the request stalls')
    const save=page.getByRole('button',{name:'Save Changes',exact:true})
    await save.click()
    await expect.poll(()=>intercepted).toBe(true)
    await page.clock.fastForward(16000)
    await expect(page.locator('.api-error')).toContainText('timed out')
    await expect(save).toBeEnabled()
    await expect(description).toHaveValue('Not lost when the request stalls')
  }finally{release()}
})
test('a disconnected dashboard retains drafts and catches up on reconnect',async({page,context})=>{
  const {activity}=await setup(page)
  const description=page.locator('.activity-editor-fields .textarea-wrap textarea').first()
  await description.fill('Draft survives an outage')
  await context.setOffline(true)
  await page.getByRole('button',{name:'Save Changes',exact:true}).click()
  await expect(page.locator('.api-error')).toBeVisible()
  await expect(description).toHaveValue('Draft survives an outage')
  await context.setOffline(false)
  await page.getByRole('button',{name:'Save Changes',exact:true}).click()
  await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeDisabled()
  await expect(description).toHaveValue('Draft survives an outage')
  expect((await(await page.request.get('/api/state')).json()).activities.find((a:{id:string})=>a.id===activity.id).description).toBe('Draft survives an outage')
})

const editorMock=`<script>
window.externalVariables={};
addEventListener('message',e=>{const d=e.data,reply=x=>e.source.postMessage({type:d.type.startsWith('classroom-')?'classroom-reply':'reply',id:d.id,...x},e.origin);
if(d.type==='classroom-load'||d.type==='classroom-actions')reply({version:-1});
if(d.type==='classroom-export')reply({xml:'<project></project>'});
if(d.type==='add-listener'||d.type==='remove-listener')reply({});
if(d.type==='set-variable')externalVariables[d.key]=d.value;
});parent.postMessage({type:'classroom-editor-ready'},new URL(document.referrer).origin);
</script>`
async function pupilSetup(page:Page,browser:import('@playwright/test').Browser){
  const {session}=await setup(page,'groups'),path='/api/sessions/'+session.id
  const group=await(await page.request.post(path+'/groups',{data:{name:'Original team'}})).json()
  const other=await(await page.request.post(path+'/groups',{data:{name:'New team'}})).json()
  const joined=await(await page.request.post('/api/participants/join',{data:{joinCode:session.joinCode,name:'Network pupil '+randomUUID()}})).json()
  expect((await page.request.post(path+'/memberships',{data:{groupId:group.id,participantIds:[joined.participantId]}})).ok()).toBe(true)
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'})
  await context.route('**/student-editor.html*',route=>route.fulfill({contentType:'text/html',body:editorMock}))
  await context.addInitScript(connection=>{
    sessionStorage.setItem('classroom.student.v1',JSON.stringify(connection))
    const Original=window.WebSocket
    ;(window as any).testSockets=[]
    window.WebSocket=class extends Original{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);(window as any).testSockets.push(this)}}
  },{sessionId:session.id,token:joined.token,name:joined.name,joinCode:session.joinCode})
  const pupil=await context.newPage()
  await pupil.goto('/student')
  await expect(pupil.getByTestId('student-group')).toHaveText('Group: Original team')
  await expect(pupil.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true')
  return {session,path,group,other,joined,context,pupil}
}
test('student state failures remain visible despite healthy heartbeats and recover when reads resume',async({page,browser})=>{
  const {context,pupil}=await pupilSetup(page,browser)
  try{
    let down=true
    await pupil.route('**/api/student/state',route=>down?route.fulfill({status:503,json:{message:'Classroom temporarily unavailable'}}):route.continue())
    await pupil.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
    await expect(pupil.locator('.student-app > [role=alert]')).toContainText('Classroom temporarily unavailable')
    const heartbeat=pupil.waitForResponse('**/api/participants/heartbeat')
    await pupil.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
    expect((await heartbeat).ok()).toBe(true)
    await expect(pupil.locator('.student-app > [role=alert]')).toContainText('Classroom temporarily unavailable')
    down=false
    await pupil.evaluate(()=>window.dispatchEvent(new Event('online')))
    await expect(pupil.locator('.student-app > [role=alert]')).toHaveCount(0)
    await expect(pupil.getByTestId('student-group')).toHaveText('Group: Original team')
  }finally{await context.close()}
})
test('student reconnect catches up on group and chat changes made during an outage',async({page,browser})=>{
  const {context,pupil,path,other,joined}=await pupilSetup(page,browser)
  try{
    await pupil.getByRole('textbox',{name:'Group message',exact:true}).fill('Private draft for the old team')
    await context.setOffline(true)
    await pupil.evaluate(()=>{for(const socket of (window as any).testSockets)socket.close()})
    await expect(pupil.getByText('Reconnecting...',{exact:true})).toBeVisible()
    expect((await page.request.post(path+'/memberships',{data:{groupId:other.id,participantIds:[joined.participantId]}})).ok()).toBe(true)
    expect((await page.request.post(path+'/groups/'+other.id+'/messages',{data:{text:'Welcome to your new group'}})).ok()).toBe(true)
    await context.setOffline(false)
    await expect(pupil.getByText('Connected',{exact:true})).toBeVisible()
    await expect(pupil.getByTestId('student-group')).toHaveText('Group: New team')
    await expect(pupil.getByRole('list',{name:'Group messages'})).toContainText('Welcome to your new group')
    await expect(pupil.getByRole('textbox',{name:'Group message',exact:true})).toHaveValue('')
    await expect(pupil.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-workspace',other.id+':')
    const stored=await pupil.evaluate(()=>JSON.parse(sessionStorage.getItem('classroom.student.v1')!))
    expect(stored.token).toBe(joined.token)
  }finally{await context.close()}
})
test('failed student messages preserve text and error across heartbeats until retried',async({page,browser})=>{
  const {context,pupil}=await pupilSetup(page,browser)
  try{
    let down=true
    await pupil.route('**/api/student/messages',route=>down?route.fulfill({status:503,json:{message:'Message temporarily unavailable'}}):route.continue())
    const text=pupil.getByRole('textbox',{name:'Group message',exact:true})
    await text.fill('Keep my message')
    await pupil.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(pupil.locator('.student-app > [role=alert]')).toContainText('Message temporarily unavailable')
    const heartbeat=pupil.waitForResponse('**/api/participants/heartbeat')
    await pupil.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
    expect((await heartbeat).ok()).toBe(true)
    await expect(pupil.locator('.student-app > [role=alert]')).toContainText('Message temporarily unavailable')
    await expect(text).toHaveValue('Keep my message')
    down=false
    await pupil.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(text).toHaveValue('')
    await expect(pupil.getByRole('list',{name:'Group messages'})).toContainText('Keep my message')
    await expect(pupil.locator('.student-app > [role=alert]')).toHaveCount(0)
  }finally{await context.close()}
})
test('an old delayed classroom snapshot cannot overwrite the newly selected session',async({page})=>{
  const {session}=await setup(page,'groups')
  const {session:other}=await(await page.request.post('/api/sessions',{data:{name:'Other network class '+randomUUID()}})).json()
  expect((await page.request.post('/api/sessions/'+other.id+'/groups',{data:{name:'Only in the new classroom'}})).ok()).toBe(true)
  await expect(page.getByLabel('Select session')).toContainText(other.name)
  let release=()=>{},held=false
  const delay=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/state?sessionId='+session.id,async route=>{
    if(held)return route.continue()
    held=true
    const response=await route.fetch()
    await delay
    await route.fulfill({response})
  })
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await expect.poll(()=>held).toBe(true)
    await page.getByLabel('Select session').selectOption(other.id)
    await expect(page.locator('.student-group-column .group-choice')).toContainText('Only in the new classroom')
    release()
    await expect(page.getByTestId('join-code')).toHaveText(other.joinCode)
    await expect(page.getByLabel('Select session')).toHaveValue(other.id)
  }finally{release()}
})

test('shared student editor reports a sync outage and recovers without rejoining',async({page,browser})=>{
  const {context,pupil}=await pupilSetup(page,browser)
  try{
    let down=true
    await pupil.route('**/api/student/editor?**',route=>down?route.fulfill({status:503,contentType:'text/html',body:'Editor gateway down'}):route.continue())
    const editor=pupil.getByTitle('Student NetsBlox editor')
    await expect(editor).toHaveAttribute('data-ready','false')
    await expect(pupil.getByRole('alert')).toContainText('503')
    down=false
    await expect(editor).toHaveAttribute('data-ready','true')
    await expect(pupil.getByRole('alert')).toHaveCount(0)
    await expect(pupil.getByText('Connected',{exact:true})).toBeVisible()
  }finally{await context.close()}
})
test('lost message acknowledgements do not automatically send the command again',async({page,browser})=>{
  const {context,pupil,path,group}=await pupilSetup(page,browser)
  try{
    let sends=0
    await pupil.route('**/api/student/messages',async route=>{
      sends++
      const result=await route.fetch()
      expect(result.ok()).toBe(true)
      await route.abort('connectionreset')
    })
    const text=pupil.getByRole('textbox',{name:'Group message',exact:true})
    await text.fill('Delivered despite a lost acknowledgement')
    await pupil.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(pupil.locator('.student-app > [role=alert]')).toContainText('may have reached the server')
    await expect(text).toHaveValue('Delivered despite a lost acknowledgement')
    await expect(pupil.getByRole('list',{name:'Group messages'})).toContainText('Delivered despite a lost acknowledgement')
    const state=await(await page.request.get('/api/state?sessionId='+path.split('/').at(-1))).json()
    const messages=state.groups.find((g:{id:string})=>g.id===group.id).messages
    expect(messages.filter((m:{text:string})=>m.text==='Delivered despite a lost acknowledgement')).toHaveLength(1)
    expect(sends).toBe(1)
  }finally{await context.close()}
})
test('an expired teacher login returns to sign-in even when the proxy returns HTML',async({page})=>{
  await setup(page)
  await page.route('**/api/sessions',route=>route.fulfill({status:401,contentType:'text/html',body:'Sign in again'}))
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('heading',{name:'Teacher log in',exact:true})).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('401')
  await expect(page.getByRole('button',{name:'Log in',exact:true})).toBeVisible()
})
