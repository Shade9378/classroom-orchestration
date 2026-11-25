import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'

test('duplicate activity preserves its configuration with independent activity and requirement IDs',async({page})=>{
  await page.request.post('/api/teacher/register',{data:{name:'Copy teacher '+randomUUID(),password:'Duplication test password'}})
  const original={id:randomUUID(),name:'Copy exercise '+randomUUID(),description:'Original instructions',starterProject:'<project name="Starter"></project>',starterProjectName:'starter.xml',category:'Sensor',completionMethod:'project',estimatedMinutes:17,requirements:[{id:randomUUID(),capability:'Humidity Sensor',quantity:2}],testConfig:{spec:"average %'numbers'",cases:'[{"inputs":[[2,4,6]],"expected":4}]'}}
  expect((await page.request.put('/api/activities/'+original.id,{data:original})).ok()).toBeTruthy()
  await page.goto('/?view=activities&libraryTab=activities&activity='+original.id)
  await expect(page.getByRole('radio',{name:/Students agree to complete/})).toBeVisible()
  await expect(page.getByText('Run a NetsBlox reporter against expected outputs.',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Duplicate',exact:true}).click()
  await expect(page.locator('.activity-editor-fields > input').first()).toHaveValue(original.name+' (Copy)')
  const snapshot=async()=> (await (await page.request.get('/api/state')).json()).activities as typeof original[]
  const copy=(await snapshot()).find(a=>a.name===original.name+' (Copy)')!
  expect(copy).toBeTruthy();expect(copy.id).not.toBe(original.id)
  expect(copy).toMatchObject({description:original.description,starterProject:original.starterProject,starterProjectName:original.starterProjectName,category:original.category,estimatedMinutes:17,completionMethod:'project',testConfig:original.testConfig})
  expect(copy.requirements[0]).toMatchObject({capability:'Humidity Sensor',quantity:2})
  expect(copy.requirements[0].id).not.toBe(original.requirements[0].id)
  await page.locator('.activity-editor-fields > input').first().fill('Edited copy '+copy.id)
  await page.getByRole('button',{name:'Save Changes',exact:true}).click()
  expect((await snapshot()).find(a=>a.id===original.id)).toMatchObject(original)
  await page.locator('.library-item').filter({hasText:original.name}).filter({hasNotText:'Copy)'}).first().click()
  await page.getByRole('button',{name:'Duplicate',exact:true}).click()
  await expect(page.locator('.activity-editor-fields > input').first()).toHaveValue(original.name+' (Copy)')
})
