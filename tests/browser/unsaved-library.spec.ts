import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
test('library save buttons track edits and navigation protects unsaved activity and playlist drafts',async({page})=>{
 const request=page.request
 await request.post('/api/teacher/register',{data:{name:`Draft teacher ${randomUUID()}`,password:'Draft test password'}})
 const a={id:randomUUID(),name:`Draft activity ${randomUUID()}`,description:'Original activity text',starterProject:'',requirements:[],recoveryPreference:'auto',completionMethod:'teacher',estimatedMinutes:10}
 await request.put(`/api/activities/${a.id}`,{data:a})
 const p={id:randomUUID(),name:`Draft playlist ${randomUUID()}`,description:'Original playlist text',activityIds:[a.id]}
 await request.put(`/api/playlists/${p.id}`,{data:p})
 await page.goto('/')
 const saveActivity=page.getByRole('button',{name:'Save Changes',exact:true}),savePlaylist=page.getByRole('button',{name:'Save Playlist',exact:true})
 await expect(saveActivity).toBeDisabled()
 const description=page.locator('textarea')
 await description.fill('Unsaved activity text')
 await expect(saveActivity).toBeEnabled()
 await description.fill(a.description)
 await expect(saveActivity).toBeDisabled()
 await description.fill('Unsaved activity text')
 const cancel=page.waitForEvent('dialog')
 const switching=page.getByRole('button',{name:'Playlists',exact:true}).click()
 const dialog=await cancel
 expect(dialog.message()).toContain('unsaved changes')
 await dialog.dismiss();await switching
 await expect(description).toHaveValue('Unsaved activity text')
 const leaving=page.waitForEvent('dialog')
 const nav=page.getByRole('button',{name:'Live Classroom',exact:true}).click()
 await(await leaving).dismiss();await nav
 await expect(saveActivity).toBeVisible()
 const closing=page.waitForEvent('dialog')
 const reload=page.reload({timeout:1500}).catch(()=>{})
 const beforeUnload=await closing
 expect(beforeUnload.type()).toBe('beforeunload')
 await beforeUnload.dismiss();await reload
 await expect(description).toHaveValue('Unsaved activity text')
 await saveActivity.click()
 await expect(saveActivity).toBeDisabled()
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await expect(savePlaylist).toBeDisabled()
 await description.fill('Unsaved playlist text')
 await expect(savePlaylist).toBeEnabled()
 const discard=page.waitForEvent('dialog')
 const activityTab=page.getByRole('button',{name:'Activities',exact:true}).click()
 await(await discard).accept();await activityTab
 await page.getByRole('button',{name:'Playlists',exact:true}).click()
 await expect(description).toHaveValue(p.description)
 await expect(savePlaylist).toBeDisabled()
 await description.fill('Saved playlist text')
 await savePlaylist.click()
 await expect(savePlaylist).toBeDisabled()
 await expect.poll(async()=>{const saved=await(await request.get('/api/state')).json();return saved.playlists.find((item:any)=>item.id===p.id).description}).toBe('Saved playlist text')
 await expect(savePlaylist).toBeDisabled()
})
