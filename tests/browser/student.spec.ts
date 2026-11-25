import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
const api = 'http://127.0.0.1:3002/api'
const mock = `<script>
let xml='<project></project>';window.externalVariables={};
addEventListener('message',e=>{const d=e.data;const reply=x=>e.source.postMessage({type:d.type.startsWith('classroom-')?'classroom-reply':'reply',id:d.id,...x},e.origin);
if(d.type==='classroom-load'){xml=d.xml;reply({version:d.version})}
if(d.type==='classroom-export')reply({xml});
if(d.type==='classroom-actions')reply({version:d.actions.at(-1)?.version??-1});
if(d.type==='get-username')reply({username:''});
if(d.type==='export-project')reply({xml});
if(d.type==='add-listener'||d.type==='remove-listener')reply({});
if(d.type==='set-variable')window.externalVariables[d.key]=d.value;
});parent.postMessage({type:'classroom-editor-ready'},new URL(document.referrer).origin);
</script>`

async function join(page: Page, code: string, name: string) {
  await page.goto(`/student?class=${code}`)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', {name:'Join class', exact:true}).click()
  await expect(page.getByText('Connected', {exact:true})).toBeVisible()
  await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})
}

test('student joins, resumes, sees live work, and exchanges messages only within their group', async ({ browser, request }) => {
  const c = await (await request.post(`${api}/sessions`, {data:{name:`Student browser ${randomUUID()}`}})).json()
  const headers = {'x-teacher-token':c.teacherToken}
  const path = `${api}/sessions/${c.session.id}`
  const g = await (await request.post(`${path}/groups`, {headers,data:{name:'Team one'}})).json()
  const h = await (await request.post(`${path}/groups`, {headers,data:{name:'Team two'}})).json()
  const contexts = await Promise.all([0,1,2].map(()=>browser.newContext()))
  try {
    for (const context of contexts) await context.route('**/student-editor.html', r=>r.fulfill({contentType:'text/html',body:mock}))
    const [alice,bob,eve] = await Promise.all(contexts.map(c=>c.newPage()))
    await join(alice,c.session.joinCode,'Alice');await join(bob,c.session.joinCode,'Bob');await join(eve,c.session.joinCode,'Eve')
    const snapshot = async()=> (await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    const students = (await snapshot()).students
    const ids = (names:string[])=>students.filter((s:{name:string})=>names.includes(s.name)).map((s:{id:string})=>s.id)
    const firstMove=await request.post(`${path}/memberships`, {headers,data:{groupId:g.id,participantIds:ids(['Alice','Bob'])}})
    expect(firstMove.ok(),await firstMove.text()).toBeTruthy()
    const secondMove=await request.post(`${path}/memberships`, {headers,data:{groupId:h.id,participantIds:ids(['Eve'])}})
    expect(secondMove.ok(),await secondMove.text()).toBeTruthy()
    await expect(alice.getByTestId('student-group')).toHaveText('Group: Team one')
    await expect(bob.getByTestId('student-teammates')).toContainText('Alice (online)')
    await expect(eve.getByTestId('student-group')).toHaveText('Group: Team two')
    const id=randomUUID(), name=`Live lesson ${randomUUID()}`
    await request.put(`${api}/activities/${id}`,{data:{id,name,description:'Live instructions',starterProject:'',requirements:[],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}})
    await request.post(`${path}/assignments`, {headers,data:{groupIds:[g.id],kind:'activity',id}})
    await expect(alice.getByTestId('student-activity')).toContainText(name)
    await expect.poll(()=>alice.frames()[1].evaluate(()=> (window as any).externalVariables.classroom.groupName)).toBe('Team one')
    await alice.getByRole('textbox',{name:'Group message',exact:true}).fill('Hello team')
    await alice.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(bob.getByRole('list',{name:'Group messages'})).toContainText('Alice: Hello team')
    await expect(eve.getByRole('list',{name:'Group messages'})).toBeEmpty()
    await bob.reload();await expect(bob.getByTestId('student-group')).toHaveText('Group: Team one')
    await request.post(`${path}/memberships`,{headers,data:{groupId:h.id,participantIds:ids(['Bob'])}})
    await expect(bob.getByTestId('student-group')).toHaveText('Group: Team two')
    await alice.getByRole('textbox',{name:'Group message',exact:true}).fill('Old group only');await alice.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(alice.getByRole('list',{name:'Group messages'})).toContainText('Old group only')
    await expect(bob.getByRole('list',{name:'Group messages'})).toBeEmpty()
    await expect.poll(async()=> (await snapshot()).students.filter((s:{status:string})=>s.status==='online').length).toBe(3)
    await bob.getByRole('button',{name:'Leave class',exact:true}).click()
    await expect(bob.getByRole('button',{name:'Join class',exact:true})).toBeVisible()
    await expect.poll(async()=> (await snapshot()).students.find((s:{name:string})=>s.name==='Bob').status).toBe('offline')
    await request.delete(path,{headers})
    await expect(alice.getByRole('alert')).toContainText('deleted')
    await expect(alice.getByRole('button',{name:'Join class',exact:true})).toBeVisible()
  } finally {for(const context of contexts)await context.close();await request.delete(path,{headers})}
})

test('real NetsBlox loads a blank starter and keeps classroom helpers connected', async ({page,request})=>{
  test.skip(process.env.NETSBLOX_SMOKE !== '1','External editor smoke test is opt-in')
  test.setTimeout(120000)
  const c=await(await request.post(`${api}/sessions`,{data:{name:`NetsBlox smoke ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`
  try {
    page.on('pageerror',e=>console.log('NetsBlox error:',e.message))
    await join(page,c.session.joinCode,'Real student')
    const frame=page.frames().find(f=>f.url().includes('/student-editor.html'))!
    await expect.poll(()=>frame.evaluate(()=> (window as any).externalVariables?.classroom?.name),{timeout:15000}).toBe('Real student')
    expect(await frame.evaluate(()=>{const w=window as any;const ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return ide.currentSprite.scripts.children.map((b:any)=>b.selector).filter(Boolean)})).toEqual([])
    const g=await(await request.post(`${path}/groups`,{headers,data:{name:'Real team'}})).json()
    const s=await(await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    const move = await request.post(`${path}/memberships`,{headers,data:{groupId:g.id,participantIds:[s.students[0].id]}}); expect(move.ok(),await move.text()).toBeTruthy()
    await expect(page.getByTestId('student-group')).toHaveText('Group: Real team')
    await expect.poll(()=>frame.evaluate(()=> (window as any).externalVariables.classroom.groupName)).toBe('Real team')
    await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-workspace',g.id+':')
    await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true')
    await frame.evaluate(async()=>{const w=window as any;const ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);const definition=ide.stage.globalBlocks.find((d:any)=>d.spec.startsWith('send to my group'));const script=definition.blockInstance();script.inputs()[0].setContents('Hello from NetsBlox!');await w.SnapActions.addBlock(script,ide.currentSprite,new w.Point(20,20));const placed=ide.currentSprite.scripts.children.find((b:any)=>b.definition?.spec.startsWith('send to my group'));ide.stage.threads.startProcess(placed)})
    await expect(page.getByRole('list',{name:'Group messages'})).toContainText('Hello from NetsBlox!')
    await frame.evaluate(()=>{const w=window as any;const ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);ide.stopAllScripts();ide.currentSprite.scripts.children.filter((b:any)=>b instanceof w.BlockMorph).forEach((b:any)=>b.destroy())})
    const next=await(await request.post(`${path}/groups`,{headers,data:{name:'After scripts deleted'}})).json()
    const reassigned=await request.post(`${path}/memberships`,{headers,data:{groupId:next.id,participantIds:[s.students[0].id]}})
    expect(reassigned.ok(),await reassigned.text()).toBeTruthy()
    await expect(page.getByTestId('student-group')).toHaveText('Group: After scripts deleted')
    await expect.poll(()=>frame.evaluate(()=> (window as any).externalVariables.classroom.groupName)).toBe('After scripts deleted')
    await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-workspace',next.id+':')
    await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true')
    expect(await frame.evaluate(()=>{const w=window as any;const ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return ide.stage.threads.processes.length})).toBe(0)
    await page.getByRole('textbox',{name:'Group message',exact:true}).fill('Still connected')
    await page.getByRole('button',{name:'Send to group',exact:true}).click()
    await expect(page.getByRole('list',{name:'Group messages'})).toContainText('Still connected')
  } finally {await request.delete(path,{headers})}
})


test('online names are rejected, offline students reconnect, and teacher removal disconnects them', async ({browser,request,page})=>{
  const c=await(await request.post(`${api}/sessions`,{data:{name:`Reconnect classroom ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`,name=`Alex ${randomUUID()}`
  const g=await(await request.post(`${path}/groups`,{headers,data:{name:'Retained group'}})).json()
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  try {
    for(const context of contexts)await context.route('**/student-editor.html',r=>r.fulfill({contentType:'text/html',body:mock}))
    const first=await contexts[0].newPage(),second=await contexts[1].newPage()
    await join(first,c.session.joinCode,name)
    const snapshot=async()=> (await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    const original=(await snapshot()).students[0]
    const assigned=await request.post(`${path}/memberships`,{headers,data:{groupId:g.id,participantIds:[original.id]}})
    expect(assigned.ok(),await assigned.text()).toBeTruthy()
    await expect(first.getByTestId('student-group')).toHaveText('Group: Retained group')
    expect((await snapshot()).groups[0].studentIds).toContain(original.id)
    await second.goto(`/student?class=${c.session.joinCode}`)
    await second.getByLabel('Your name').fill(` ${name.toUpperCase()} `)
    await second.getByRole('button',{name:'Join class',exact:true}).click()
    await expect(second.getByRole('alert')).toContainText('already online')
    await first.getByRole('button',{name:'Leave class',exact:true}).click()
    await expect.poll(async()=> (await snapshot()).students[0].status).toBe('offline')
    await second.getByRole('button',{name:'Join class',exact:true}).click()
    await expect(second.getByTestId('student-group')).toHaveText('Group: Retained group')
    expect((await snapshot()).students.map((s:{id:string})=>s.id)).toEqual([original.id])
    await page.request.post(`${api}/teacher/register`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.request.post(`${api}/teacher/login`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.goto(`/?session=${c.session.id}`)
    await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    for(const width of [1440,375]) {
      await page.setViewportSize({width,height:1000})
      for(const view of ['Live Classroom','Group Assignments']) {
        const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true })
        if (await menu.isVisible()) await menu.click()
        await page.getByRole('button',{name:view,exact:true}).click()
        if (view === 'Live Classroom') await page.getByRole('button', { name: 'Students', exact: true }).click()
        await expect(page.locator('.student-roster')).toBeVisible()
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await page.locator('.student-roster').screenshot({path:`test-results/student-roster-${view==='Live Classroom'?'live':'groups'}-${width}.png`})
      }
    }
    await page.setViewportSize({width:1440,height:1000})
    await page.locator('.student-table-row').filter({hasText:name}).getByRole('checkbox').check()

    const unassign=page.locator('.student-membership-actions').getByRole('button',{name:'Unassign',exact:true})
    await expect(unassign).toBeEnabled()
    await unassign.click()
    await expect(page.locator('.student-table-row').filter({hasText:name})).toContainText('Unassigned')
    await expect(unassign).toBeDisabled()
    await expect.poll(async()=> (await snapshot()).groups[0].studentIds).toEqual([])
    await expect(second.getByTestId('student-group')).toContainText('Waiting for your teacher to assign a group')
    expect((await snapshot()).students.map((s:{id:string})=>s.id)).toEqual([original.id])
    await page.reload()
    await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    await expect(page.locator('.student-table-row').filter({hasText:name})).toContainText('Unassigned')
    await page.locator('.student-table-row').filter({hasText:name}).getByRole('checkbox').check()
    const remove=page.getByRole('button',{name:`Remove ${name} from session`,exact:true})
    page.once('dialog',dialog=>dialog.dismiss());await remove.click();await expect(remove).toBeVisible()
    page.once('dialog',dialog=>dialog.accept());await remove.click();await expect(remove).toHaveCount(0)
    await expect(page.locator('.assignment-column').first().getByText('(0 selected)',{exact:true})).toBeVisible()
    await expect(second.getByRole('alert')).toContainText('removed you')
    await expect(second.getByRole('button',{name:'Join class',exact:true})).toBeVisible()
    expect((await snapshot()).students).toHaveLength(0)
    expect((await snapshot()).groups[0].studentIds).toEqual([])
  }finally{for(const context of contexts)await context.close();await request.delete(path,{headers})}
})


test('select all includes filtered students and Auto Group balances the saved memberships',async({page,request})=>{
  const c=await(await request.post(`${api}/sessions`,{data:{name:`Auto UI ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`
  const names=Array.from({length:7},(_,i)=>`Auto student ${i} ${randomUUID()}`)
  try {
    for(const name of names)await request.post(`${api}/participants/join`,{data:{joinCode:c.session.joinCode,name}})
    await page.request.post(`${api}/teacher/register`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.request.post(`${api}/teacher/login`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.goto(`/?session=${c.session.id}`)
    await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    const auto=page.getByRole('button',{name:'Auto Group',exact:true})
    const all=page.getByRole('checkbox',{name:'Select all students',exact:true})
    await all.check();await expect(auto).toBeDisabled()
    for(let i=0;i<3;i++)await request.post(`${path}/groups`,{headers,data:{name:`Auto group ${i}`}})
    await expect(auto).toBeEnabled()
    await all.uncheck();await expect(auto).toBeDisabled()
    await page.getByRole('checkbox',{name:`Select ${names[0]}`,exact:true}).check()
    await expect(all).toHaveJSProperty('indeterminate',true)
    await page.getByPlaceholder('Search students...', {exact:true}).fill(names[0])
    await all.check()
    await expect(page.getByText('(7 selected)',{exact:true})).toBeVisible()
    await page.getByPlaceholder('Search students...', {exact:true}).fill('')
    for(const name of names)await expect(page.getByRole('checkbox',{name:`Select ${name}`,exact:true})).toBeChecked()
    const saved=page.waitForResponse(r=>r.url().endsWith('/memberships/auto') && r.request().method()==='POST')
    await auto.click()
    expect((await saved).ok()).toBe(true)
    await expect(all).not.toBeChecked()
    await expect(page.locator('.student-group-column').getByText('(0 selected)',{exact:true})).toBeVisible()
    await expect(auto).toBeDisabled()
    const state=await(await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    expect(state.groups.map((g:{studentIds:string[]})=>g.studentIds.length).sort()).toEqual([2,2,3])
    await page.reload();await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    expect(await page.locator('.student-roster .group-color-none').count()).toBe(0)
    for(const width of [1440,375]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)}
  }finally{await request.delete(path,{headers})}
})


test('visibility switches show yellow Away and returning restores green Online',async({page,browser,request})=>{
  const c=await(await request.post(`${api}/sessions`,{data:{name:`Visibility ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`,name=`Visibility student ${randomUUID()}`
  const context=await browser.newContext(),student=await context.newPage()
  try{
    await context.route('**/student-editor.html',r=>r.fulfill({contentType:'text/html',body:mock}))
    await join(student,c.session.joinCode,name)
    await page.request.post(`${api}/teacher/register`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.request.post(`${api}/teacher/login`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.goto(`/?session=${c.session.id}`)
    await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    const row=page.locator('.student-table-row').filter({hasText:name})
    await student.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))})
    await expect(row.locator('.student-presence')).toHaveText('Away')
    await expect(row.locator('.status-dot')).toHaveCSS('background-color','rgb(234, 179, 8)')
    // block app heartbeats so native browser pongs has to keep presence alive
    await student.route('**/api/participants/heartbeat',r=>r.abort())
    await new Promise(resolve=>setTimeout(resolve,3000))
    expect((await(await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()).students[0].status).toBe('away')
    await student.unroute('**/api/participants/heartbeat')
    await student.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))})
    await expect(row.locator('.student-presence')).toHaveText('Online')
    await expect(row.locator('.status-dot')).toHaveCSS('background-color','rgb(22, 163, 74)')
    await student.getByRole('button',{name:'Leave class',exact:true}).click()
    await expect(row.locator('.student-presence')).toHaveText('Offline')
    await expect(row.locator('.status-dot')).toHaveCSS('background-color','rgb(156, 163, 175)')
  }finally{await context.close();await request.delete(path,{headers})}
})
