import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('refresh restores the main page, subtab and selected library item',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Refresh teacher ${randomUUID()}`,password:'Refresh test password'}})
 const {session}=await(await request.post('/api/sessions',{data:{name:`Refresh ${randomUUID()}`}})).json()
 const a={id:randomUUID(),name:`Refresh activity ${randomUUID()}`,description:'',starterProject:'',requirements:[],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 await request.put(`/api/activities/${a.id}`,{data:a})
 const playlists=[]
 for(const name of ['First playlist','Second playlist']){
  const p={id:randomUUID(),name:name+' '+randomUUID(),description:'',activityIds:[a.id]}
  await request.put(`/api/playlists/${p.id}`,{data:p});playlists.push(p)
 }
 const group=await(await request.post(`/api/sessions/${session.id}/groups`,{data:{name:'Group 1'}})).json()
 await page.goto(`/?session=${session.id}`)
 await page.getByRole('button',{name:'Group Assignments',exact:true}).click()
 await page.getByRole('button',{name:'Resource Allocation',exact:true}).click()
 await page.locator('input[name="resource-target"]').check()
 await page.reload()
 await expect(page.getByRole('button',{name:'Group Assignments',exact:true})).toHaveAttribute('aria-current','page')
 await expect(page.getByRole('heading',{name:'Device Pool',exact:true})).toBeVisible()
 await expect(page.locator('input[name="resource-target"]')).toBeChecked()
 expect(new URL(page.url()).searchParams.get('resourceGroup')).toBe(group.id)
 await page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await page.getByRole('button',{name:'Devices',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'Live Classroom',exact:true})).toHaveAttribute('aria-current','page')
 await expect(page.getByRole('button',{name:'Devices',exact:true})).toHaveClass(/selected/)
 await page.getByRole('button',{name:'Activities & Playlists',exact:true}).click()
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await page.locator('.playlist-card').filter({hasText:playlists[0].name}).click()
 await page.reload()
 await expect(page.getByRole('heading',{name:'Edit Playlist',exact:true})).toBeVisible()
 await expect(page.locator('.playlist-card.active')).toContainText(playlists[0].name)
 await expect(page.getByRole('button',{name:'Save Playlist',exact:true})).toBeDisabled()
})
