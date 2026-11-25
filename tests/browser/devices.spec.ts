import {randomUUID} from 'node:crypto'
import {createServer,type Server} from 'node:http'
import {advertiseDevices,type ProvisionableDevice} from '../../server/deviceProvisioning'
import {test,expect,type Page} from '@playwright/test'
let server:Server,temperature=24,advertiser:Awaited<ReturnType<typeof advertiseDevices>>,registrations=0
const robotCommands:string[]=[]
const classroomIds:string[]=[]
test.afterEach(async({page})=>{
  for(const id of classroomIds.splice(0)){
    const closed=await page.request.patch('/api/sessions/'+id,{data:{status:'closed'}})
    expect(closed.ok(),await closed.text()).toBeTruthy()
  }
})
const registered=new Set<string>(),phoneCredentials=new Map<string,string>()
const localDevices=Array.from({length:6},(_,i)=>{const n=i%2+1,type=i<2?'Phone':i<4?'Sensor':'Robot';return {id:randomUUID(),name:`${type} ${n}`,type,mode:type==='Robot'?'roboscape':'iotscape',serviceName:type==='Robot'?'RoboScape':`ClassroomDemo${type}s`,remoteDeviceId:type==='Robot'?`02000000000${n}`:`${type.toLowerCase()}${n}`} as Omit<ProvisionableDevice,'registered'>})
test.beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b
    const body=JSON.parse(raw||'{}'),path=new URL(req.url!,'http://localhost').pathname
    let value:unknown
    if(path.startsWith('/PhoneIoT')){
      const method=path.split('/')[2],clientId=new URL(req.url!,'http://localhost').searchParams.get('clientId')??''
      if(!method)value={rpcs:{authenticate:{args:[{name:'device'}]},getAccelerometer:{args:[{name:'device'}]},setCredentials:{args:[{name:'device'},{name:'password'}]}}}
      else if(method==='setCredentials'){phoneCredentials.set(clientId,body.password);value='OK'}
      else if(body.device!=='aabbccddeeff'||phoneCredentials.get(clientId)!=='real-phone-password'){res.writeHead(500);res.end('incorrect password');return}
      else value=method==='getAccelerometer'?[0.5,1,9.7]:true
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return
    }
    if(path==='/IoTScape/getServices')value=['ClassroomDemoSensors','ClassroomDemoPhones']
    else if(path==='/IoTScape/getDevices')value=localDevices.filter(d=>d.serviceName===body.service&&registered.has(d.remoteDeviceId)).map(d=>d.remoteDeviceId)
    else if(path==='/RoboScape/getRobots')value=localDevices.filter(d=>d.mode==='roboscape'&&registered.has(d.remoteDeviceId)).map(d=>d.remoteDeviceId)
    else if(path==='/RoboScape/send'){robotCommands.push(body.command);value=body.command==='get range'?850:body.command==='get ticks'?[0,0]:true}
    else if(path.endsWith('/getReadings'))value=[['temperature',temperature,'deg C'],['batteryLevel',82,'%'],['health','healthy','']]
    else if(path.endsWith('/setEnvironment')){temperature=Number(body.temperature);value=true}
    else if(/^\/ClassroomDemo(Sensors|Phones)$/.test(path))value={rpcs:{getReadings:{args:[{name:'id'}]},setEnvironment:{args:[{name:'id'},{name:'temperature'},{name:'humidity'}]}}}
    else {res.writeHead(404);res.end('unknown RPC');return}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
  })
  await new Promise<void>(resolve=>server.listen(4199,'127.0.0.1',resolve))
  advertiser=await advertiseDevices(localDevices,4198,'http://127.0.0.1:4199',async d=>{registrations++;registered.add(d.remoteDeviceId)})
})
test.afterAll(async()=>{await advertiser.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
async function setup(page:Page) {
  expect((await page.request.post('/api/teacher/register',{data:{name:`Device teacher ${randomUUID()}`,password:'Device test password'}})).ok()).toBeTruthy()
  const session=(await(await page.request.post('/api/sessions',{data:{name:`NetsBlox demo ${randomUUID()}`}})).json()).session
  classroomIds.push(session.id)
  await page.request.post(`/api/sessions/${session.id}/groups`,{data:{name:'Group 1'}})
  await page.goto(`/?session=${session.id}`)
  await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
  await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
  await page.getByRole('main').getByRole('button',{name:'Connect device',exact:true}).click()
  await expect(page.getByLabel('Device source')).toBeVisible()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  return session
}
test('discover six NetsBlox devices, attach explicitly, call native RPC and assign to a group',async({page})=>{
  const session=await setup(page),snapshot=async()=>await(await page.request.get(`/api/state?sessionId=${session.id}`)).json()
  const connect=async(name:string)=>{
    await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
    await page.getByLabel('Device source').selectOption('local')
    await page.getByLabel('Nearby device').selectOption({label:`${name} - ${name.split(' ')[0]}`})
    await page.getByRole('button',{name:'Connect',exact:true}).click()
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
  }
  expect((await snapshot()).devices).toHaveLength(0)
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  await page.getByLabel('Device source').selectOption('local')
  await expect(page.getByLabel('Nearby device')).toContainText('Sensor 1')
  expect(registrations).toBe(0)
  expect((await snapshot()).devices).toHaveLength(0)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await connect('Sensor 1')
  expect(registrations).toBe(1)
  await expect(page.locator('.device-inspector-body > .device-readings')).toContainText('24')
  await expect(page.getByRole('region',{name:'Battery'})).toContainText('82%')
  await expect(page.getByRole('dialog').getByText('healthy',{exact:true})).toHaveCount(0)
  await page.getByLabel('RPC',{exact:true}).selectOption('setEnvironment')
  await page.getByLabel('temperature',{exact:true}).fill('30')
  await page.getByLabel('humidity',{exact:true}).fill('50')
  await page.getByRole('button',{name:'Call RPC',exact:true}).click()
  await expect(page.getByLabel('RPC result')).toHaveText('true')
  await expect(page.locator('.device-inspector-body > .device-readings')).toContainText('30',{timeout:10000})
  await page.getByLabel('Device assigned group').selectOption({label:'Group 1'})
  await connect('Sensor 2')
  for(let n=1;n<=2;n++)await connect(`Phone ${n}`)
  for(let n=1;n<=2;n++)await connect(`Robot ${n}`)
  expect((await snapshot()).devices).toHaveLength(6)
  expect(registrations).toBe(6)
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await expect(page.locator('.device-inspector .status-pill')).toHaveText('paused')
  await page.getByRole('button',{name:'Reconnect device',exact:true}).click()
  await expect(page.locator('.device-inspector .status-pill')).toHaveText('connected')
  await page.getByRole('button',{name:'Close device window',exact:true}).click()
  await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
  await page.getByRole('button',{name:'Devices',exact:true}).click()
  await page.locator('.device-overview-table').getByRole('button',{name:'View Sensor 1 details',exact:true}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Sensor 1',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close device window',exact:true}).click()
  await page.locator('.device-overview-table').getByRole('button',{name:'View Robot 1 details',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading',{name:'Robot 1',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close device window',exact:true}).click()
  await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
  await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
  await page.getByRole('checkbox',{name:'Select Sensor 2',exact:true}).check()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.locator('.resource-device-list').getByRole('button',{name:'View Phone 1 details',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Phone 1',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close device window',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Select Sensor 2',exact:true})).toBeChecked()
  await expect(page.getByRole('checkbox',{name:'Select Phone 1',exact:true})).not.toBeChecked()
  await page.locator('.resource-device-row').filter({has:page.getByRole('checkbox',{name:'Select Sensor 2',exact:true})}).getByText('Any Sensor',{exact:true}).click()
  await expect(page.getByRole('heading',{name:'Sensor 2',exact:true})).toBeVisible()
  await expect(page.getByText('Choose Bluetooth device',{exact:true})).toHaveCount(0)
})

test('teacher connects a PhoneIoT phone by ID/password and failed authentication does not save it',async({page})=>{
  const session=await setup(page),snapshot=async()=>await(await page.request.get(`/api/state?sessionId=${session.id}`)).json()
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  await page.getByLabel('Device source').selectOption('phoneiot')
  await page.getByLabel('PhoneIoT device ID').fill('AABBCCDDEEFF')
  await page.getByLabel('PhoneIoT password').fill('incorrect')
  await page.getByLabel('Name',{exact:true}).fill('Classroom phone')
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not authenticate')
  expect((await snapshot()).devices).toHaveLength(0)
  await page.getByLabel('PhoneIoT password').fill('real-phone-password')
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Classroom phone',exact:true})).toBeVisible()
  await expect(page.locator('.device-inspector')).toContainText('PhoneIoT')
  await expect(page.locator('.device-inspector-body > .device-readings')).toContainText('9.7')
  await expect(page.getByRole('region',{name:'Battery'}).getByText('Unavailable',{exact:true})).toHaveCount(1)
  await page.getByLabel('Device assigned group').selectOption({label:'Group 1'})
  await page.getByLabel('RPC',{exact:true}).selectOption('getAccelerometer')
  await page.getByRole('button',{name:'Call RPC',exact:true}).click()
  await expect(page.getByLabel('RPC result')).toHaveText('[0.5,1,9.7]')
  expect(JSON.stringify(await snapshot())).not.toContain('real-phone-password')
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await expect(page.locator('.device-inspector .status-pill')).toHaveText('paused')
  await page.getByRole('button',{name:'Reconnect phone',exact:true}).click()
  await expect(page.getByLabel('PhoneIoT device ID')).toHaveValue('aabbccddeeff')
  await expect(page.getByLabel('PhoneIoT password')).toHaveValue('')
  await page.getByLabel('PhoneIoT password').fill('real-phone-password')
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Classroom phone',exact:true})).toBeVisible()
  expect((await snapshot()).devices).toHaveLength(1)
})

test('embedded device RPCs hold one student owner and release automatically when their script ends',async({page,browser})=>{
  const session=await setup(page)
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  await page.getByLabel('Device source').selectOption('local')
  await page.getByLabel('Nearby device').selectOption({label:'Robot 1 - Robot'})
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Robot 1',exact:true})).toBeVisible()
  await page.getByLabel('Device assigned group').selectOption({label:'Group 1'})
  const state=await(await page.request.get(`/api/state?sessionId=${session.id}`)).json(),group=state.groups[0]
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  const mock=`<script src="/student-device-control.js"></script><script>
  window.externalVariables={};let xml='<project></project>';
  window.Process=class{pushContext(){}};Process.prototype.callRPC=function(){throw Error('Unexpected direct service call')};
  window.ide={services:{defaultHost:{url:'https://services.netsblox.org'}},stage:{threads:{processes:[]}},stopAllScripts(){this.stage.threads.processes=[]},showMessage(){}};
  const origin=new URL(document.referrer).origin;installClassroomDeviceControls(ide,d=>parent.postMessage(d,origin),origin,()=>true);
  addEventListener('message',e=>{const d=e.data;const reply=x=>parent.postMessage({type:'classroom-reply',id:d.id,...x},origin);
    if(d.type==='classroom-load'){xml=d.xml;reply({version:d.version})}
    if(d.type==='classroom-export')reply({xml});if(d.type==='classroom-actions')reply({version:d.actions.at(-1)?.version??-1});
    if(d.type==='add-listener')parent.postMessage({type:'reply',id:d.id},origin);
    if(d.type==='set-variable')window.externalVariables[d.key]=d.value;
  });
  window.begin=()=>{window.command={};const p=new Process();ide.stage.threads.processes.push(p);
    const timer=setInterval(()=>{try{const value=p.callRPC('https://services.netsblox.org/RoboScape/send',{robot:'020000000001',command:'set speed 20 20'},true);if(value!==undefined){window.command.result=JSON.parse(value);clearInterval(timer)}}catch(e){window.command.error=e.message;ide.stage.threads.processes=ide.stage.threads.processes.filter(x=>x!==p);clearInterval(timer)}},15)
  };
  parent.postMessage({type:'classroom-editor-ready'},origin);
  </script>`
  try{
    for(const context of contexts)await context.route('**/student-editor.html',r=>r.fulfill({contentType:'text/html',body:mock}))
    const students=await Promise.all(contexts.map(c=>c.newPage()))
    for(const [i,student] of students.entries()){
      await student.goto(`/student?class=${session.joinCode}`);await student.getByLabel('Your name').fill(`Lock student ${i} ${randomUUID()}`)
      await student.getByRole('button',{name:'Join class',exact:true}).click()
    }
    await expect.poll(async()=> (await(await page.request.get(`/api/state?sessionId=${session.id}`)).json()).students.length).toBe(2)
    const joined=await(await page.request.get(`/api/state?sessionId=${session.id}`)).json()
    const assigned=await page.request.post(`/api/sessions/${session.id}/memberships`,{data:{groupId:group.id,participantIds:joined.students.map((s:{id:string})=>s.id)}})
    expect(assigned.ok(),await assigned.text()).toBeTruthy()
    for(const student of students)await expect(student.getByRole('table',{name:'Assigned devices'})).toContainText('Robot 1')
    const frames=students.map(s=>s.frames().find(f=>f.url().includes('student-editor.html'))!)
    for(const frame of frames)await expect.poll(()=>frame.evaluate(()=>JSON.parse((window as any).externalVariables.classroom?.devices??'[]').length)).toBe(1)
    await frames[0].evaluate(()=> (window as any).begin())
    await expect.poll(()=>frames[0].evaluate(()=> (window as any).command.result)).toBe(true)
    await frames[1].evaluate(()=> (window as any).begin())
    await expect.poll(()=>frames[1].evaluate(()=> (window as any).command.error)).toContain('controlling this device')
    await students[0].getByRole('button',{name:'Stop scripts and release devices'}).click()
    await expect(students[1].getByRole('table',{name:'Assigned devices'})).toContainText('Available')
    await frames[1].evaluate(()=> (window as any).begin())
    await expect.poll(()=>frames[1].evaluate(()=> (window as any).command.result)).toBe(true)
    await frames[1].evaluate(()=> (window as any).ide.stage.threads.processes=[])
    await expect(students[0].getByRole('table',{name:'Assigned devices'})).toContainText('Available')
  }finally{for(const context of contexts)await context.close()}
})

test('real NetsBlox device RPC blocks enforce ownership and finish automatically',async({page,browser})=>{
  test.skip(process.env.NETSBLOX_SMOKE!=='1','External NetsBlox integration is opt-in')
  test.setTimeout(120000)
  const session=await setup(page)
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  await page.getByLabel('Device source').selectOption('local')
  await page.getByLabel('Nearby device').selectOption({label:'Robot 1 - Robot'})
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Robot 1',exact:true})).toBeVisible()
  await page.getByLabel('Device assigned group').selectOption({label:'Group 1'})
  const snapshot=async()=>await(await page.request.get(`/api/state?sessionId=${session.id}`)).json(),group=(await snapshot()).groups[0]
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  try{
    const students=await Promise.all(contexts.map(c=>c.newPage()))
    for(const [i,student] of students.entries()){
      await student.goto(`/student?class=${session.joinCode}`)
      await student.getByLabel('Your name').fill(`Native driver ${i} ${randomUUID()}`)
      await student.getByRole('button',{name:'Join class',exact:true}).click()
      await expect(student.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})
    }
    const state=await snapshot()
    await page.request.post(`/api/sessions/${session.id}/memberships`,{data:{groupId:group.id,participantIds:state.students.map((s:{id:string})=>s.id)}})
    for(const student of students){await expect(student.getByRole('table',{name:'Assigned devices'})).toContainText('Robot 1');await expect(student.getByTitle('Student NetsBlox editor')).toHaveAttribute('data-ready','true',{timeout:60000})}
    const frames=students.map(s=>s.frames().find(f=>f.url().includes('student-editor.html'))!)
    const start=async(i:number,seconds:number)=>frames[i].evaluate(seconds=>{
      const w=window as any,ide=w.world.children.find((c:any)=>c instanceof w.IDE_Morph),sprite=ide.currentSprite
      const block=sprite.blockForSelector('doRunRPC');sprite.scripts.add(block)
      block.inputs()[0].setContents('RoboScape');block.inputs()[1].setContents('send')
      block.inputs()[2].setContents('020000000001');block.inputs()[3].setContents('set speed 20 20')
      const wait=sprite.blockForSelector('doWait');wait.inputs()[0].setContents(seconds);block.nextBlock(wait)
      w.probeProcess=ide.stage.threads.startProcess(block)
    },seconds)
    const before=robotCommands.filter(c=>c==='set speed 20 20').length
    await start(0,3)
    await expect.poll(async()=> (await snapshot()).devices[0].control?.name).toContain('Native driver 0')
    await start(1,1)
    await expect.poll(()=>frames[1].evaluate(()=> (window as any).probeProcess.errorFlag)).toBe(true)
    expect(robotCommands.filter(c=>c==='set speed 20 20')).toHaveLength(before+1)
    await expect.poll(async()=> (await snapshot()).devices[0].control,{timeout:10000}).toBeUndefined()
    await start(1,0.3)
    await expect.poll(()=>robotCommands.filter(c=>c==='set speed 20 20').length).toBe(before+2)
    await expect.poll(async()=> (await snapshot()).devices[0].control,{timeout:10000}).toBeUndefined()
  }finally{for(const context of contexts)await context.close()}
})

test('unneeded device assignments warn and cancellation preserves both allocation and detail assignments',async({page})=>{
  const session=await setup(page),path=`/api/sessions/${session.id}`,snapshot=async()=>await(await page.request.get(`/api/state?sessionId=${session.id}`)).json()
  for(const name of ['Phone 1','Robot 1']){
    await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
    await page.getByLabel('Device source').selectOption('local')
    await page.getByLabel('Nearby device').selectOption({label:`${name} - ${name.split(' ')[0]}`})
    await page.getByRole('button',{name:'Connect',exact:true}).click()
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
  }
  const activityId=randomUUID(),name=`Robot requirement ${randomUUID()}`
  expect((await page.request.put(`/api/activities/${activityId}`,{data:{id:activityId,name,description:'Lorem ipsum',starterProject:'',requirements:[{id:randomUUID(),capability:'Robot',quantity:1}],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:5}})).ok()).toBeTruthy()
  const second=await(await page.request.post(`${path}/groups`,{data:{name:'Group 2'}})).json()
  const first=(await snapshot()).groups.find((g:{name:string})=>g.name==='Group 1')
  expect((await page.request.post(`${path}/assignments`,{data:{groupIds:[first.id,second.id],kind:'activity',id:activityId}})).ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
  await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
  await page.getByRole('checkbox',{name:'Select Phone 1',exact:true}).check()
  await page.locator('input[name="resource-target"]').first().check()
  const assign=page.getByRole('button',{name:/Assign 1 Devices to Group 1/})
  const confirm=async(action:()=>Promise<unknown>,accept:boolean)=>{
    const dialogPromise=page.waitForEvent('dialog'),pending=action(),dialog=await dialogPromise
    expect(dialog.message()).toContain('Phone 1 is not required for the assignment')
    expect(dialog.message()).toMatch(/Group [12]'s assigned work/)
    if(accept)await dialog.accept();else await dialog.dismiss()
    await pending
  }
  await confirm(()=>assign.click(),false)
  expect((await snapshot()).devices.find((d:{name:string})=>d.name==='Phone 1').assignedGroupId).toBeUndefined()
  await expect(page.getByRole('checkbox',{name:'Select Phone 1',exact:true})).toBeChecked()
  await confirm(()=>assign.click(),true)
  await expect.poll(async()=> (await snapshot()).devices.find((d:{name:string})=>d.name==='Phone 1').assignedGroupId).toBe(first.id)
  await page.locator('.resource-device-list').getByRole('button',{name:'View Phone 1 details',exact:true}).click()
  await confirm(()=>page.getByLabel('Device assigned group').selectOption(second.id),false)
  await expect(page.getByLabel('Device assigned group')).toHaveValue(first.id)
  await confirm(()=>page.getByLabel('Device assigned group').selectOption(second.id),true)
  await expect.poll(async()=> (await snapshot()).devices.find((d:{name:string})=>d.name==='Phone 1').assignedGroupId).toBe(second.id)
  await page.getByRole('button',{name:'Close device window',exact:true}).click()
  await page.getByRole('checkbox',{name:'Select Robot 1',exact:true}).check()
  const unexpected:string[]=[];page.on('dialog',async d=>{unexpected.push(d.message());await d.dismiss()})
  await assign.click()
  await expect.poll(async()=> (await snapshot()).devices.find((d:{name:string})=>d.name==='Robot 1').assignedGroupId).toBe(first.id)
  expect(unexpected).toHaveLength(0)
  await expect(page.getByRole('checkbox',{name:'Select Robot 1',exact:true})).not.toBeChecked()
  await page.getByRole('checkbox',{name:'Select Robot 1',exact:true}).check()
  await page.getByRole('button',{name:'Unassign selected devices',exact:true}).click()
  await expect.poll(async()=> (await snapshot()).devices.find((d:{name:string})=>d.name==='Robot 1').assignedGroupId).toBeUndefined()
  expect((await snapshot()).devices.find((d:{name:string})=>d.name==='Phone 1').assignedGroupId).toBe(second.id)
  await page.locator('.resource-device-list').getByRole('button',{name:'View Phone 1 details',exact:true}).click()
  await page.getByRole('button',{name:'Unassign device',exact:true}).click()
  await expect(page.getByLabel('Device assigned group')).toHaveValue('')
  await expect.poll(async()=> (await snapshot()).devices.find((d:{name:string})=>d.name==='Phone 1').assignedGroupId).toBeUndefined()
  expect((await snapshot()).devices).toHaveLength(2)
})

test('normal connection screen names both native services and hides local testing', async ({page}) => {
  await page.route('**/netsblox-devices/connection-options', route => route.fulfill({json:{localDeviceTesting:false}}))
  await setup(page)
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  const source=page.getByLabel('Device source')
  await expect(source).toHaveValue('registered')
  await expect(source.locator('option')).toHaveText(['Registered with RoboScape or IoTScape','PhoneIoT (device ID and password)'])
  await expect(page.getByLabel('NetsBlox service').locator('option')).toHaveText(['IoTScape (sensors and other devices)','RoboScape (robots)'])
  await expect(page.getByLabel('Nearby device')).toHaveCount(0)
})

test('already connected devices are hidden in discovery and duplicate POST requests are rejected',async({page})=>{
  const session=await setup(page),path=`/api/sessions/${session.id}/netsblox-devices`
  registered.add('sensor1')
  const payload={mode:'iotscape',serviceName:'ClassroomDemoSensors',remoteDeviceId:'sensor1',name:'Saved sensor',type:'Sensor'}
  expect((await page.request.post(path,{data:payload})).ok()).toBeTruthy()
  const duplicate=await page.request.post(path,{data:{...payload,name:'A different name'}})
  expect(duplicate.status()).toBe(409)
  await page.getByRole('dialog').getByRole('button',{name:'Connect device',exact:true}).click()
  await page.getByLabel('IoTScape service',{exact:true}).selectOption('ClassroomDemoSensors')
  const option=page.getByLabel('Device ID',{exact:true}).locator('option[value="sensor1"]')
  await expect(page.getByLabel('Device ID',{exact:true})).toBeEnabled()
  await expect(option).toHaveCount(0)
})
