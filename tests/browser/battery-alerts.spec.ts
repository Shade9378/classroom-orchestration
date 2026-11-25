import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('low battery alerts include known low readings and clear when battery recovers',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Battery teacher ${randomUUID()}`,password:'Battery test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Battery alerts ${randomUUID()}`}})).json()
 const snapshot=await(await request.get(`/api/state?sessionId=${session.id}`)).json()
 const devices=[{id:'low',name:'Low phone',type:'Phone',capability:'Phone',status:'online',batteryLevel:20},{id:'zero',name:'Empty robot',type:'Robot',capability:'Robot',status:'offline',batteryLevel:0},{id:'healthy',name:'Charged sensor',type:'Sensor',capability:'Any Sensor',status:'online',batteryLevel:21},{id:'critical',name:'Critical phone',type:'Phone',capability:'Phone',status:'online',batteryLevel:4},{id:'boundary',name:'Five percent sensor',type:'Sensor',capability:'Any Sensor',status:'online',batteryLevel:5},{id:'unknown',name:'Unknown battery',type:'Sensor',capability:'Any Sensor',status:'online',batteryLevel:null}]
 await page.route(`**/api/state?sessionId=${session.id}`,route=>route.fulfill({json:{...snapshot,devices}}))
 await page.goto(`/?session=${session.id}`)
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await page.getByRole('button',{name:'Alerts (3)',exact:true}).click()
 const alerts=page.locator('.overview-alerts')
 await expect(alerts.locator('.alert-card')).toHaveCount(3)
 await expect(alerts.locator('.alert-card.error')).toHaveCount(1)
 await expect(alerts.locator('.alert-card.error')).toContainText(['Critical phone (Phone) battery critically low'])
 await expect(alerts.locator('.alert-card.warning').filter({hasText:'Five percent sensor'})).toContainText('5% battery remaining')
 await expect(alerts).toContainText('Low phone (Phone) battery low')
 await expect(alerts).toContainText('20% battery remaining')
 await expect(alerts).not.toContainText('Empty robot')
 await expect(alerts).not.toContainText('Charged sensor')
 await expect(alerts).not.toContainText('Unknown battery')
 devices[0].batteryLevel=80
 await page.reload()
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await page.getByRole('button',{name:'Alerts (2)',exact:true}).click()
 await expect(alerts).not.toContainText('Low phone (Phone) battery low')
 await expect(alerts).toContainText('Critical phone (Phone) battery critically low')
})
