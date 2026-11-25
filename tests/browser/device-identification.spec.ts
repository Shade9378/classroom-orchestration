import {expect,test} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {createServer,type Server} from 'node:http'
let server:Server,originalOnline=true
const commands:string[]=[]
test.beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    const args=JSON.parse(raw||'{}'),path=new URL(req.url!,'http://localhost').pathname
    let value:unknown
    if(path==='/IoTScape/getServices')value=[]
    else if(path==='/RoboScape/getRobots')value=['020000000091','020000000092']
    else if(path==='/RoboScape/send'){
      if(args.robot==='020000000091'&&!originalOnline){res.writeHead(503);res.end('offline');return}
      if(String(args.command).startsWith('beep'))commands.push(args.robot+':'+args.command)
      value=args.command==='get range'?750:true
    }else{res.writeHead(404);res.end('unknown');return}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
  })
  await new Promise<void>(resolve=>server.listen(4199,'127.0.0.1',resolve))
})
test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
test('approved replacement counts down globally; manual identification works unassigned and can be cancelled',async({page})=>{
  test.setTimeout(45000)
  const post=async(url:string,data?:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBeTruthy();return response.json()}
  await post('/api/teacher/register',{name:'Identify teacher '+randomUUID(),password:'Identification test password'})
  const {session}=await post('/api/sessions',{name:'Identify class '+randomUUID()})
  const base='/api/sessions/'+session.id,group=await post(base+'/groups',{name:'Group 1'})
  const attach=(id:string,name:string)=>post(base+'/netsblox-devices',{mode:'roboscape',serviceName:'RoboScape',remoteDeviceId:id,name,type:'Robot'})
  const original=await attach('020000000091','Original robot'),spare=await attach('020000000092','Spare robot')
  await post(base+'/device-assignments',{groupId:group.id,deviceIds:[original.id]})
  originalOnline=false
  await page.goto('/?session='+session.id)
  const alert=page.locator('.classroom-notification.error').filter({hasText:'Original robot (Robot) disconnected'})
  await expect(alert.getByRole('button',{name:'Approve replacement',exact:true})).toBeVisible({timeout:15000})
  await alert.getByRole('button',{name:'Approve replacement',exact:true}).click()
  const identify=page.getByRole('complementary',{name:'Device identification'})
  await expect(identify).toContainText('Spare robot (Robot)')
  await expect(identify).toContainText('Identify in')
  expect(commands).toEqual([])
  await page.getByRole('button',{name:'Activities & Playlists',exact:true}).click()
  await page.reload()
  await expect(identify).toContainText('Identify in')
  await expect(identify).toContainText('Beep acknowledged',{timeout:15000})
  expect(commands).toEqual(['020000000092:beep 1000 880'])
  await identify.getByRole('button',{name:'Dismiss',exact:true}).click()
  await post(base+'/device-assignments',{groupId:group.id,deviceIds:[original.id]})
  const unassign=await page.request.delete(base+'/device-assignments',{data:{deviceIds:[spare.id]}});expect(unassign.ok()).toBeTruthy()
  await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
  await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
  await page.getByRole('button',{name:'View Spare robot details',exact:true}).click()
  await page.getByRole('button',{name:'Identify device',exact:true}).click()
  await expect(identify).toContainText('Identify in')
  await expect(identify.getByRole('button',{name:'Cancel identification',exact:true})).toBeVisible()
  await page.screenshot({path:'.local/device-identification-dialog.png'})
  await identify.getByRole('button',{name:'Cancel identification',exact:true}).click()
  await expect.poll(async()=>{const response=await page.request.get(base+'/netsblox-devices/identifications');return (await response.json()).jobs.at(-1).state}).toBe('cancelled')
  expect(commands).toHaveLength(1)
})
