import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('playlist resource summary reflects saved activity quantity, capability and removal edits',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Playlist teacher ${randomUUID()}`,password:'Playlist test password'}})
 const activity={id:randomUUID(),name:`Editable robot ${randomUUID()}`,description:'',starterProject:'',requirements:[{id:randomUUID(),capability:'Robot (RoboScape)',quantity:1}],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 const other={...activity,id:randomUUID(),name:`Second robot ${randomUUID()}`,requirements:[{id:randomUUID(),capability:'Robot (RoboScape)',quantity:2}]}
 for(const a of [activity,other])expect((await request.put(`/api/activities/${a.id}`,{data:a})).ok()).toBeTruthy()
 const playlist={id:randomUUID(),name:`Requirements playlist ${randomUUID()}`,description:'',activityIds:[activity.id,other.id]}
 expect((await request.put(`/api/playlists/${playlist.id}`,{data:playlist})).ok()).toBeTruthy()
 await page.goto('/')
 await page.getByRole('button',{name:'Activities & Playlists',exact:true}).click()
 await page.locator('.library-item').filter({hasText:activity.name}).click()
 await page.locator('.requirement-row select').nth(1).selectOption('3')
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await page.locator('.playlist-card').filter({hasText:playlist.name}).click()
 const summary=page.locator('.playlist-resource-panel')
 await expect(summary.locator('.resource-card')).toHaveCount(1)
 await expect(summary).toContainText('3 devices required')
 await page.locator('.playlist-edit-row').filter({hasText:activity.name}).getByRole('button',{name:'Edit',exact:true}).click()
 await page.locator('.requirement-row select').nth(0).selectOption('Phone / Tablet')
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await expect(summary.locator('.resource-card')).toHaveCount(2)
 await expect(summary.locator('.resource-card').filter({hasText:'Phone / Tablet'})).toContainText('3 devices required')
 await expect(summary.locator('.resource-card').filter({hasText:'Robot'})).toContainText('2 devices required')
 await page.locator('.playlist-edit-row').filter({hasText:activity.name}).getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByRole('button',{name:'Remove hardware requirement',exact:true}).click()
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await expect(summary.locator('.resource-card')).toHaveCount(1)
 await expect(summary).not.toContainText('Phone / Tablet')
 await expect(summary).toContainText('2 devices required')
})
