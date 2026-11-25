import {randomUUID} from 'node:crypto'
import {test,expect} from '@playwright/test'
import {starterProject} from '../../src/student/starter'
const api='http://127.0.0.1:3002/api'
test('real NetsBlox group editors share blocks, preserve work on reload, and isolate moved students',async({browser,request})=>{
  test.skip(process.env.NETSBLOX_SMOKE!=='1','External NetsBlox integration is opt-in')
  test.setTimeout(180000)
  const c=await(await request.post(`${api}/sessions`,{data:{name:`Collaboration ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`
  const g=await(await request.post(`${path}/groups`,{headers,data:{name:'Shared team'}})).json()
  const h=await(await request.post(`${path}/groups`,{headers,data:{name:'Other team'}})).json()
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  try {
    const pages=await Promise.all(contexts.map(c=>c.newPage()))
    for(const [i,page] of pages.entries()) {
      await page.goto(`/student?class=${c.session.joinCode}`)
      await page.getByLabel('Your name').fill(`Collaborator ${i} ${randomUUID()}`)
      await page.getByRole('button',{name:'Join class',exact:true}).click()
      await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})
    }
    const s=await(await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    await request.post(`${path}/memberships`,{headers,data:{groupId:g.id,participantIds:s.students.map((s:{id:string})=>s.id)}})
    for(const page of pages){await expect(page.getByTestId('student-group')).toContainText('Shared team');await expect(page.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})}
    const frame=(i:number)=>pages[i].frames().find(f=>f.url().includes('/student-editor.html'))!
    await expect.poll(()=>frame(0).evaluate(()=> (window as any).SnapActions.id)).toBe(s.students.find((x:{name:string})=>x.name.startsWith('Collaborator 0')).id)
    for(const i of [0,1])await expect.poll(()=>frame(i).evaluate(()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return ide.currentSprite.scripts.children.length})).toBe(0)
    await frame(0).evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);await w.SnapActions.addBlock(ide.currentSprite.blockForSelector('forward'),ide.currentSprite,new w.Point(100,100))})
    const count=(i:number)=>frame(i).evaluate(()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return ide.currentSprite.scripts.children.filter((b:any)=>b.selector==='forward').length})
    await expect.poll(()=>count(1)).toBe(1)
    await frame(1).evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);const block=ide.currentSprite.scripts.children.find((b:any)=>b.selector==='forward');await w.SnapActions.setField(block.inputs()[0],'42')})
    await expect.poll(()=>frame(0).evaluate(()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return String(ide.currentSprite.scripts.children.find((b:any)=>b.selector==='forward').inputs()[0].evaluate())})).toBe('42')
    await frame(1).evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);await w.SnapActions.renameSprite(ide.currentSprite,'Team Sprite')})
    await expect.poll(()=>frame(0).evaluate(()=>{const w=window as any;return w.world.children.find((c:any)=>c instanceof w.IDE_Morph).currentSprite.name})).toBe('Team Sprite')
    await pages[1].reload();await expect(pages[1].getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000});await expect.poll(()=>count(1)).toBe(1)
    const moved=s.students.find((x:{name:string})=>x.name.startsWith('Collaborator 1')).id
    await request.post(`${path}/memberships`,{headers,data:{groupId:h.id,participantIds:[moved]}})
    await expect(pages[1].getByTestId('student-group')).toContainText('Other team')
    await expect.poll(()=>count(1),{timeout:30000}).toBe(0)
    await frame(0).evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);await w.SnapActions.renameSprite(ide.currentSprite,'Original Team')})
    expect(await frame(1).evaluate(()=>{const w=window as any;return w.world.children.find((c:any)=>c instanceof w.IDE_Morph).currentSprite.name})).not.toBe('Original Team')
    await pages[0].screenshot({path:'test-results/shared-netsblox.png'})
  }finally{for(const c of contexts)await c.close();await request.delete(path,{headers})}
})


test('uploaded instructor starter loads, student edits survive reassignments, and teacher reset restarts the activity',async({browser,request,page})=>{
  test.skip(process.env.NETSBLOX_SMOKE!=='1','External NetsBlox integration is opt-in')
  test.setTimeout(180000)
  const name=`Starter lesson ${randomUUID()}`,id=randomUUID()
  const lesson={id,name,description:'Start from instructor code',starterProject:'',requirements:[],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
  await request.put(`${api}/activities/${id}`,{data:lesson})
  const c=await(await request.post(`${api}/sessions`,{data:{name:`Starter classroom ${randomUUID()}`}})).json()
  const headers={'x-teacher-token':c.teacherToken},path=`${api}/sessions/${c.session.id}`
  const g=await(await request.post(`${path}/groups`,{headers,data:{name:'Starter group'}})).json()
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  try {
    await page.request.post(`${api}/teacher/register`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.request.post(`${api}/teacher/login`,{data:{name:'Test teacher',password:'Teacher test password'}})
    await page.goto(`/?session=${c.session.id}`)
    await page.locator('.library-item').filter({hasText:name}).click()
    const xml=starterProject.replace('name="Student" idx=','name="Instructor starter" idx=').replace('<scripts /></sprite>', '<scripts><script x="20" y="20"><block s="forward"><l>23</l></block></script></scripts></sprite>')
    await page.getByLabel('Upload starter project').setInputFiles({name:'instructor.xml',mimeType:'application/xml',buffer:Buffer.from(xml)})
    await expect(page.locator('.file-name')).toContainText('instructor.xml')
    await page.getByRole('button',{name:'Save Changes',exact:true}).click()
    await expect.poll(async()=>{const s=await(await request.get(`${api}/state`)).json();return s.activities.find((a:{id:string})=>a.id===id)?.starterProject}).toBe(xml)
    const students=await Promise.all(contexts.map(c=>c.newPage()))
    for(const [i,p] of students.entries()){
      await p.goto(`/student?class=${c.session.joinCode}`);await p.getByLabel('Your name').fill(`Starter student ${i} ${randomUUID()}`);await p.getByRole('button',{name:'Join class',exact:true}).click()
      await expect(p.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})
    }
    const roster=await(await request.get(`${api}/state?sessionId=${c.session.id}`,{headers})).json()
    await request.post(`${path}/memberships`,{headers,data:{groupId:g.id,participantIds:roster.students.map((p:{id:string})=>p.id)}})
    await request.post(`${path}/assignments`,{headers,data:{groupIds:[g.id],kind:'activity',id}})
    const frame=(i:number)=>students[i].frames().find(f=>f.url().includes('/student-editor.html'))!
    const spriteName=(i:number)=>frame(i).evaluate(()=>{const w=window as any;return w.world.children.find((c:any)=>c instanceof w.IDE_Morph).currentSprite.name})
    for(const i of [0,1]){await expect.poll(()=>spriteName(i),{timeout:60000}).toBe('Instructor starter');await expect(students[i].getByTitle('Student NetsBlox editor')).toHaveAttribute('data-workspace',`${g.id}:${id}`);await expect(students[i].getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true')}
    for(const i of [0,1])await expect.poll(()=>frame(i).evaluate(()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return String(ide.currentSprite.scripts.children.find((b:any)=>b.selector==='forward').inputs()[0].evaluate())})).toBe('23')

    await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
    const teacherEditor=page.getByTitle('Starter group NetsBlox live editor')
    await expect(teacherEditor).toHaveAttribute('data-ready','true',{timeout:60000})
    const teacherFrame=()=>page.frames().find(f=>f.url().includes('/student-editor.html'))!
    const teacherName=()=>teacherFrame().evaluate(()=>{const w=window as any;return w.world.children.find((c:any)=>c instanceof w.IDE_Morph).currentSprite.name})
    await expect.poll(teacherName).toBe('Instructor starter')
    expect(await teacherFrame().evaluate(()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);return {small:ide.isSmallStage,ratio:ide.stageRatio}})).toEqual({small:true,ratio:0.5})
    await teacherFrame().evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);try{await w.SnapActions.renameSprite(ide.currentSprite,'Teacher edit')}catch{}})
    expect(await teacherName()).toBe('Instructor starter')
    expect(await spriteName(0)).toBe('Instructor starter')
    await page.getByRole('button',{name:'Expand editor',exact:true}).click()
    await expect(page.getByRole('button',{name:'Close expanded view',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Close expanded view',exact:true}).click()
    await frame(0).evaluate(async()=>{const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph);await w.SnapActions.renameSprite(ide.currentSprite,'Student work')})
    await expect.poll(teacherName).toBe('Student work')
    await expect.poll(()=>spriteName(1)).toBe('Student work')
    await students[1].reload();await expect(students[1].getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000});await expect.poll(()=>spriteName(1)).toBe('Student work')
    await request.post(`${path}/assignments`,{headers,data:{groupIds:[g.id],kind:'activity',id}})
    await expect.poll(()=>spriteName(0)).toBe('Student work')
    await request.delete(`${path}/groups/${g.id}/assignments`,{headers,data:{kind:'activity',id}})
    await expect.poll(()=>spriteName(0),{timeout:30000}).toBe('Student')
    await expect.poll(teacherName,{timeout:30000}).toBe('Student')
    await request.post(`${path}/assignments`,{headers,data:{groupIds:[g.id],kind:'activity',id}})
    await expect.poll(()=>spriteName(0),{timeout:30000}).toBe('Student work')
    await expect.poll(teacherName,{timeout:30000}).toBe('Student work')
    await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
    const reset=page.locator('.assignment-preview-card').filter({hasText:'Starter group'}).getByRole('button',{name:'Reset to starter',exact:true})
    page.once('dialog',d=>d.dismiss());await reset.click();expect(await spriteName(0)).toBe('Student work')
    page.once('dialog',d=>d.accept());await reset.click()
    for(const i of [0,1])await expect.poll(()=>spriteName(i),{timeout:30000}).toBe('Instructor starter')
    await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
    await expect(page.getByTitle('Starter group NetsBlox live editor')).toHaveAttribute('data-ready','true',{timeout:60000})
    await expect.poll(teacherName).toBe('Instructor starter')
    await page.screenshot({path:'test-results/teacher-live-netsblox.png'})
  }finally{for(const c of contexts)await c.close();await request.delete(path,{headers});await request.delete(`${api}/activities/${id}`)}
})
