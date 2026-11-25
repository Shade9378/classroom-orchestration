import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import type { Activity, Device, Group, Playlist } from '../../src/types'
import { reconcileGroupWork } from '../../src/state/groupWork'
import { missingHardwareRequirements } from '../../src/state/hardware'

const activity = (id: string, name: string): Activity => ({ id, name, description: 'Explore, build, and share what you discover.', starterProject: '', requirements: [], recoveryPreference: 'auto', completionMethod: 'teacher', estimatedMinutes: 15 })
const a = activity('00000000-0000-4000-8000-000000000001', 'Draw a square')
const b = activity('00000000-0000-4000-8000-000000000002', 'Follow the light')
const playlist: Playlist = { id: '00000000-0000-4000-8000-000000000003', name: 'A little robot adventure', description: 'Two small challenges. Plenty to discover.', activityIds: ['00000000-0000-4000-8000-000000000001'] }
const group = (overrides: Partial<Group> = {}): Group => ({ id: 'g', name: 'Group 1', studentIds: [], deviceIds: [], assignedActivityIds: ['00000000-0000-4000-8000-000000000001'], assignedPlaylistIds: [], activityId: '00000000-0000-4000-8000-000000000001', status: 'running', ...overrides })
const device = (id: string, status: Device['status'] = 'online'): Device => ({ id, name: 'Robot ' + id, capability: 'Robot', type: 'Robot', status, assignedGroupId: 'g' })
let credential: { session: { id: string; joinCode: string }; teacherToken: string }
test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:3002/api/teacher/register',{data:{name:'Test teacher',password:'Teacher test password'}})
  expect((await request.post('http://127.0.0.1:3002/api/teacher/login',{data:{name:'Test teacher',password:'Teacher test password'}})).ok()).toBeTruthy()
  await page.request.post('http://127.0.0.1:3002/api/teacher/login',{data:{name:'Test teacher',password:'Teacher test password'}})
  const sessions = await (await request.get('http://127.0.0.1:3002/api/sessions')).json()
  for (const session of sessions) await request.delete(`http://127.0.0.1:3002/api/sessions/${session.id}`)
  const state = (await request.get('http://127.0.0.1:3002/api/state')).json()
  for (const a of (await state).activities) await request.delete(`http://127.0.0.1:3002/api/activities/${a.id}`)
  for (const p of (await state).playlists) await request.delete(`http://127.0.0.1:3002/api/playlists/${p.id}`)
})
async function navigate(page:Page,name:string){
  await page.locator('.topbar').waitFor({state:'visible'})
  const nav=page.getByRole('navigation',{name:'Primary navigation'})
  const button=nav.getByRole('button',{name,exact:true})
  if(!await button.isVisible())await page.getByRole('button',{name:'Open navigation menu',exact:true}).click()
  await button.click()
}
async function seed(page: Page, data: { activities?: Activity[]; playlists?: Playlist[]; groups?: Group[]; devices?: Device[] } = {}) {
  const api = page.request
  const put = async (path: string, payload: unknown) => {
    const r = await api.put(`http://127.0.0.1:3002/api/${path}`, { data: payload })
    expect(r.ok(), await r.text()).toBeTruthy()
  }
  const activities = data.activities ?? [a, b], playlists = data.playlists ?? [playlist]
  for (const item of activities) await put(`activities/${item.id}`, { ...item, requirements: item.requirements.map(r => ({ ...r, id: randomUUID() })) })
  for (const item of playlists) await put(`playlists/${item.id}`, item)
  credential = await (await api.post('http://127.0.0.1:3002/api/sessions', { data: { name: `Browser test ${randomUUID()}` } })).json()
  const prefix = `http://127.0.0.1:3002/api/sessions/${credential.session.id}`
  const headers = { 'x-teacher-token': credential.teacherToken }
  for (const g of data.groups ?? []) {
    const created = (await api.post(`${prefix}/groups`, { headers, data: { name: g.name } })).json()
    const groupId = (await created).id
    for (const id of g.assignedActivityIds ?? []) await api.post(`${prefix}/assignments`, { headers, data: { groupIds: [groupId], kind: 'activity', id } })
    for (const id of g.assignedPlaylistIds ?? []) await api.post(`${prefix}/assignments`, { headers, data: { groupIds: [groupId], kind: 'playlist', id } })
    for (const d of data.devices ?? []) {
      const r = await api.post(`${prefix}/devices`, { headers, data: { name: d.name, type: d.type, capabilities: [d.capability], status: d.status.toUpperCase() } })
      await api.post(`${prefix}/device-assignments`, { headers, data: { groupId, deviceIds: [(await r.json()).id] } })
    }
  }
  await page.request.post('http://127.0.0.1:3002/api/teacher/login',{data:{name:'Test teacher',password:'Teacher test password'}})
  await page.goto(`/?session=${credential.session.id}`)
  await expect(page.getByLabel('Select session')).toBeVisible()
  await expect(page.getByText('Loading classroom...')).toHaveCount(0)
  if (activities[0]) await page.locator('.library-item').filter({ hasText: activities[0].name }).click()
  if (playlists[0]) {
    await page.getByRole('button', { name: 'Playlists', exact: true }).click()
    await page.locator('.playlist-card').filter({ hasText: playlists[0].name }).click()
    await page.getByRole('button', { name: 'Activities', exact: true }).click()
  }
}
async function persisted(page: Page, name: string) {
  const r = await page.request.get(`http://127.0.0.1:3002/api/state?sessionId=${credential.session.id}`, { headers: { 'x-teacher-token': credential.teacherToken } })
  return (await r.json())[name]
}

test('adding from activity view survives switching tabs, saving, and reload', async ({ page }) => {
  await seed(page)
  await page.locator('.library-item').filter({ hasText: b.name }).click()
  await page.getByRole('button', { name: 'Add to Playlist', exact: true }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Activities in This Playlist (2)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeDisabled()
  await expect(page.locator('.classroom-content')).toBeEnabled()
  await page.reload()
  expect((await persisted(page, 'playlists'))[0].activityIds).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])
})

test('external playlist additions preserve unsaved editor changes', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await page.locator('.playlist-editor textarea').fill('My edited instructions')
  const result=await page.request.put('/api/playlists/'+playlist.id,{data:{...playlist,activityIds:[a.id,b.id]}})
  expect(result.ok()).toBeTruthy()
  await expect(page.locator('.playlist-edit-row')).toHaveCount(2)
  await expect(page.locator('.playlist-editor textarea')).toHaveValue('My edited instructions')
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await expect(page.locator('.classroom-content')).toBeEnabled()
  await expect.poll(async () => (await persisted(page, 'playlists'))[0]).toMatchObject({ activityIds: [a.id,b.id], description: 'My edited instructions' })
})

test('deleting an activity removes all references and selects remaining group work', async ({ page }) => {
  await seed(page, { groups: [group({ assignedActivityIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] })] })
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Activity', exact: true }).click()
  await expect(page.locator('.library-item').filter({ hasText: a.name })).toHaveCount(0)
  expect((await persisted(page, 'groups'))[0]).toMatchObject({ assignedActivityIds: ['00000000-0000-4000-8000-000000000002'], activityId: '00000000-0000-4000-8000-000000000002', status: 'running' })
  expect((await persisted(page, 'playlists'))[0].activityIds).toEqual([])
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeDisabled()
  await expect(page.locator('.classroom-content')).toBeEnabled()
  expect((await persisted(page, 'playlists'))[0].activityIds).toEqual([])
  await page.reload()
  await navigate(page,'Live Classroom')
  await expect(page.locator('.progress-row').filter({hasText:b.name})).toContainText('In Progress')
})

test('deleting the final assigned activity makes the group idle', async ({ page }) => {
  await seed(page, { groups: [group()] })
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Activity', exact: true }).click()
  await expect(page.locator('.library-item').filter({ hasText: a.name })).toHaveCount(0)
  expect((await persisted(page, 'groups'))[0]).toMatchObject({ assignedActivityIds: [], status: 'idle' })
  expect((await persisted(page, 'groups'))[0].activityId).toBeUndefined()
})

test('deleting an active playlist selects another assigned playlist', async ({ page }) => {
  const second: Playlist = { ...playlist, id: '00000000-0000-4000-8000-000000000004', name: 'Light experiments', activityIds: ['00000000-0000-4000-8000-000000000002'] }
  await seed(page, { playlists: [playlist, second], groups: [group({ assignedActivityIds: [], assignedPlaylistIds: ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], playlistId: '00000000-0000-4000-8000-000000000003' })] })
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Playlist', exact: true }).click()
  await expect(page.locator('.playlist-card')).toHaveCount(1)
  expect((await persisted(page, 'groups'))[0]).toMatchObject({ assignedPlaylistIds: ['00000000-0000-4000-8000-000000000004'], playlistId: '00000000-0000-4000-8000-000000000004', activityId: '00000000-0000-4000-8000-000000000002' })
})

test('one robot does not satisfy four required robots in either screen', async ({ page }) => {
  const requirement = { id: 'r', capability: 'Robot (RoboScape)', quantity: 4 }
  await seed(page, { activities: [{ ...a, requirements: [requirement] }, b], groups: [group({ deviceIds: ['1'] })], devices: [device('1')] })
  await navigate(page,'Group Assignments')
  await page.getByRole('button', { name: 'Resource Allocation', exact: true }).click()
  await expect(page.locator('.readiness-card')).toContainText('3x Robot (RoboScape)')
  await expect(page.locator('.readiness-card')).not.toContainText('All requirements met')
  await navigate(page,'Live Classroom')
  await page.getByRole('button', { name: /^Alerts \(/ }).click()
  await expect(page.locator('.alerts-list')).toContainText('Missing 3 x Robot (RoboScape)')
})

test('hardware counts online devices and does not reuse them for duplicate requirements', () => {
  const r = { id: 'r', capability: 'Robot (RoboScape)', quantity: 4 }
  expect(missingHardwareRequirements([r], [device('1'), device('2', 'offline'), device('3', 'degraded')])[0].quantity).toBe(3)
  expect(missingHardwareRequirements([r], [1,2,3,4].map(n => device(String(n))))).toEqual([])
  expect(missingHardwareRequirements([{ ...r, capability: 'Distance Sensor', quantity: 1 }], [{ ...device('multi'), capabilities: ['Robot', 'Distance Sensor'] }])).toEqual([])
  expect(missingHardwareRequirements([{ ...r, quantity: 1 }, { ...r, id: 'r2', quantity: 1 }], [device('1')])).toHaveLength(1)
})

test('specific sensors get distinct hardware before wildcard sensor requirements', () => {
  const sensor: Device = { id: 's', name: 'Distance', capability: 'Distance Sensor', type: 'Sensor', status: 'online' }
  const missing = missingHardwareRequirements([{ id: 'any', capability: 'Any Sensor', quantity: 1 }, { id: 'distance', capability: 'Distance Sensor', quantity: 1 }], [sensor])
  expect(missing).toEqual([{ id: 'any', capability: 'Any Sensor', quantity: 1 }])
})

test('group reconciliation preserves current work, supports legacy groups, and idles empty playlists', () => {
  expect(reconcileGroupWork(group({ assignedActivityIds: ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'] }), [a,b], [playlist])).toMatchObject({ activityId: '00000000-0000-4000-8000-000000000001', assignedActivityIds: ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'] })
  expect(reconcileGroupWork(group({ assignedActivityIds: undefined }), [b], [])).toMatchObject({ assignedActivityIds: [], status: 'idle', activityId: undefined })
  expect(reconcileGroupWork(group({ assignedActivityIds: [], assignedPlaylistIds: ['00000000-0000-4000-8000-000000000003'], playlistId: '00000000-0000-4000-8000-000000000003' }), [b], [{ ...playlist, activityIds: [] }])).toMatchObject({ assignedPlaylistIds: ['00000000-0000-4000-8000-000000000003'], status: 'idle', activityId: undefined })
})

for (const width of [1440, 375]) {
  test(`all screens fit a ${width}px viewport with populated data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await seed(page, { activities: [{ ...a, requirements: [{ id: 'robot', capability: 'Robot (RoboScape)', quantity: 2 }] }, b], playlists: [{ ...playlist, activityIds: ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'] }], groups: [group({ assignedActivityIds: [], assignedPlaylistIds: ['00000000-0000-4000-8000-000000000003'], playlistId: '00000000-0000-4000-8000-000000000003', deviceIds: ['1'] })], devices: [device('1')] })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(async () => (await document.fonts.load('600 24px "Bricolage Grotesque Variable"')).length)).toBeGreaterThan(0)
    expect(await page.evaluate(async () => (await document.fonts.load('400 14px "DM Sans Variable"')).length)).toBeGreaterThan(0)
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `test-results/design-${width}-${name}.png`, fullPage: true })
    }
    await capture('activities')
    await page.getByRole('button', { name: 'Playlists', exact: true }).click()
    await capture('playlists')
    await navigate(page,'Group Assignments')
    await capture('groups')
    await page.getByRole('button', { name: 'Resource Allocation', exact: true }).click()
    await capture('resources')
    await navigate(page,'Live Classroom')
    await capture('live')
    if(width===1440){
      const overview=await page.locator('.overview-panel').boundingBox(),main=await page.locator('.live-main').boundingBox()
      expect(Math.abs(overview!.height-main!.height)).toBeLessThanOrEqual(1)
    }
    await page.getByRole('button',{name:/^Alerts \(/}).click()
    await expect(page.locator('.overview-alerts')).toBeVisible()
    await expect(page.locator('.live-sidebar .alerts-panel')).toHaveCount(0)
    await capture('alerts')

    expect(errors).toEqual([])
  })
  test(`empty activity workspace fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByText('No activities yet', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `test-results/design-${width}-empty.png`, fullPage: true })
  })
}


test('create session, RPC join, live membership, timeout, recovery and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Session name', exact: true }).fill('Checkpoint 2')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  const code = page.getByTestId('join-code')
  await expect(code).toHaveText(/^[A-Z2-9]{6}$/)
  const originalCode = await code.textContent()
  await navigate(page,'Group Assignments')
  await page.locator('.student-group-column').getByRole('button', { name: 'New Group', exact: true }).click()
  const joined = await page.request.post('http://127.0.0.1:3002/rpc/Classroom/joinSession', { data: { joinCode: await code.textContent(), name: 'Anh Vu' } })
  expect(joined.ok()).toBeTruthy()
  const token = await joined.text()
  const row = page.locator('.student-table-row').filter({ hasText: 'Anh Vu' })
  await expect(row).toContainText('Online', { timeout: 4000 })
  await row.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Move 1 Students to Group 1', exact: true }).click()
  await expect(row).toContainText('G1')
  await expect(row).toContainText('Offline', { timeout: 5000 })
  await page.request.post('http://127.0.0.1:3002/rpc/Classroom/heartbeat', { data: { token } })
  await expect(row).toContainText('Online', { timeout: 4000 })
  await page.reload()
  await navigate(page,'Group Assignments')
  await expect(row).toContainText('G1')
  await expect(page.getByTestId('join-code')).toHaveText(originalCode ?? '')
  await page.getByRole('button', { name: 'Close session', exact: true }).click()
  const denied = await page.request.post('http://127.0.0.1:3002/rpc/Classroom/heartbeat', { data: { token } })
  expect(denied.status()).toBe(409)
})


test('old local data is cleared while server library and session access remain', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    for (const name of ['activities', 'playlists', 'students', 'groups', 'devices']) {
      localStorage.setItem(`cp1.polished.multiassign.v3.${name}`, '[{"id":"old"}]')
    }
    localStorage.setItem('cp1.older.activities', '[]')
    localStorage.setItem('unrelated.preference', 'keep')
  })
  await page.reload()
  await expect(page.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  await expect(page.locator('.library-item').filter({ hasText: a.name })).toBeVisible()
  await expect(page.getByText('Your previous browser library is available.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import browser library', exact: true })).toHaveCount(0)
  const storage = await page.evaluate(() => ({
    oldKeys: Object.keys(localStorage).filter(k => k.startsWith('cp1.')),
    session: localStorage.getItem('classroom.active-session'),
    credentials: JSON.parse(localStorage.getItem('classroom.teacher-sessions.v1')!),
    unrelated: localStorage.getItem('unrelated.preference'),
  }))
  expect(storage.oldKeys).toEqual([])
  expect(storage.session).toBeNull()
  expect(storage.credentials).toBeNull()
  expect(storage.unrelated).toBe('keep')
})

test('failed saves show the server error and preserve the saved activity', async ({ page }) => {
  await seed(page)
  await page.locator('.editor-panel .text-input').first().fill('Unsaved rename')
  await page.route(`**/api/activities/${a.id}`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Save unavailable' }) }))
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Save unavailable')
  await expect(page.locator('.classroom-content')).toBeEnabled()
  expect((await persisted(page, 'activities')).find((item: Activity) => item.id === a.id).name).toBe(a.name)
})


test('session deletion can be cancelled and removes only the selected saved session', async ({ page, context }) => {
  await seed(page, { groups: [group()] })
  const observer = await context.newPage()
  await observer.goto(`/?session=${credential.session.id}`)
  await expect(observer.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  await page.getByRole('textbox', { name: 'Session name', exact: true }).fill('Keep this session')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Select session' })).not.toHaveValue(credential.session.id)
  await page.getByRole('combobox', { name: 'Select session' }).selectOption(credential.session.id)
  await expect(page.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete session', exact: true }).click()
  await expect(page.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete session', exact: true }).click()
  await expect(page.getByTestId('join-code')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Select session' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Select session' }).locator('option')).toHaveText(['Library only', 'Keep this session'])
  await expect(observer.getByTestId('join-code')).toHaveCount(0)
  await expect(observer.getByRole('combobox', { name: 'Select session' }).locator('option')).toHaveText(['Library only', 'Keep this session'])
  await expect(page.locator('.library-item').filter({ hasText: a.name })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Select session' }).locator('option')).toHaveText(['Library only', 'Keep this session'])
  const denied = await page.request.get(`http://127.0.0.1:3002/api/state?sessionId=${credential.session.id}`, { headers: { 'x-teacher-token': credential.teacherToken } })
  expect(denied.status()).toBe(404)
  await observer.close()
})


test('duplicate session, activity and playlist names show save errors', async ({ page }) => {
  await seed(page)
  const savedSessionName = await page.getByRole('combobox', { name: 'Select session' }).locator('option:checked').textContent()
  await page.getByRole('textbox', { name: 'Session name', exact: true }).fill(` ${savedSessionName!.toUpperCase()} `)
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('session')
  await expect(page.getByRole('alert')).toContainText('already exists')
  await expect(page.getByRole('combobox', { name: 'Select session' }).locator('option')).toHaveCount(2)
  await page.locator('.library-item').filter({ hasText: b.name }).click()
  await page.locator('.editor-panel .text-input').first().fill(` ${a.name.toUpperCase()} `)
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('activity')
  expect((await persisted(page, 'activities')).find((item: Activity) => item.id === b.id).name).toBe(b.name)
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button', { name: 'New Playlist', exact: true }).click()
  await expect(page.locator('.playlist-editor .text-input').first()).toHaveValue('New Playlist')
  await page.locator('.playlist-editor .text-input').first().fill(` ${playlist.name.toUpperCase()} `)
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('playlist')
  expect((await persisted(page, 'playlists')).map((p: Playlist) => p.name).sort()).toEqual([playlist.name, 'New Playlist'].sort())
})

test('new activity and playlist placeholders and repeated copies have distinct names', async ({ page }) => {
  await page.goto('/')
  for (const name of ['New Activity', 'New Activity (2)']) {
    await page.getByRole('button', { name: 'New Activity', exact: true }).click()
    await expect(page.locator('.editor-panel .text-input').first()).toHaveValue(name)
  }
  for (const name of ['New Playlist', 'New Playlist (2)']) {
    await page.getByRole('button', { name: 'New Playlist', exact: true }).click()
    await expect(page.locator('.playlist-editor .text-input').first()).toHaveValue(name)
  }
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.playlist-editor .text-input').first()).toHaveValue('New Playlist (2) (Copy)')
  await page.locator('.playlist-card').filter({ hasText: /^New Playlist \(2\)/ }).filter({ hasNotText: '(Copy)' }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.playlist-editor .text-input').first()).toHaveValue('New Playlist (2) (Copy) (2)')
})


test('database sessions sync across tabs and editing a name clears stale conflicts', async ({page,context}) => {
  await seed(page,{activities:[],playlists:[]})
  const second = await context.newPage(); await second.goto('/')
  await expect(second.getByLabel('Select session')).toBeVisible()
  const name = `Other tab ${randomUUID()}`
  await second.getByLabel('Session name').fill(name)
  await second.getByRole('button',{name:'Create session',exact:true}).click()
  await expect(second.getByLabel('Select session').locator('option').filter({hasText:name})).toHaveCount(1)
  await expect(page.getByLabel('Select session').locator('option').filter({hasText:name})).toHaveCount(1)
  await page.getByLabel('Session name').fill(name)
  await page.getByRole('button',{name:'Create session',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('already exists')
  await page.getByLabel('Session name').fill(`New name ${randomUUID()}`)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button',{name:'Create session',exact:true}).click()
  await expect(page.getByLabel('Select session').locator('option')).toHaveCount(4)
  await expect(second.getByLabel('Select session').locator('option')).toHaveCount(4)
})


test('database sessions are available after sign-in without browser backups', async ({page}) => {
  credential = await (await page.request.post('http://127.0.0.1:3002/api/sessions',{data:{name:`Database session ${randomUUID()}`}})).json()
  await page.request.post('http://127.0.0.1:3002/api/teacher/logout',{data:{}})
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Teacher log in'})).toBeVisible()
  await page.getByLabel('Name',{exact:true}).fill('Test teacher')
  await page.getByLabel('Password').fill('Wrong password')
  await page.getByRole('button',{name:'Log in',exact:true}).click()
  await expect(page.getByRole('alert')).toHaveText('Incorrect teacher name or password.')
  await page.getByLabel('Password').fill('Teacher test password')
  await page.getByRole('button',{name:'Log in',exact:true}).click()
  await expect(page.getByLabel('Select session').locator('option')).toHaveCount(2)
  await page.getByLabel('Select session').selectOption(credential.session.id)
  await expect(page.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await page.reload()
  await expect(page.getByTestId('join-code')).toHaveText(credential.session.joinCode)
  await expect(page.getByRole('button',{name:'Restore sessions',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Back up access',exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([])
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Teacher log in'})).toBeVisible()
})


test('teacher can create a named account and log in again',async({page})=>{
  await page.request.post('http://127.0.0.1:3002/api/teacher/logout',{data:{}})
  await page.goto('/')
  await page.getByRole('tab',{name:'Create account',exact:true}).click()
  const name=`Teacher ${randomUUID()}`
  await page.getByLabel('Name',{exact:true}).fill(name)
  await page.getByLabel('Password').fill('New teacher password')
  await page.getByRole('button',{name:'Create account',exact:true}).click()
  await expect(page.locator('.teacher-account-name')).toHaveText(name)
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.getByRole('tab',{name:'Create account',exact:true}).click()
  await page.getByLabel('Password').fill('New teacher password')
  await page.getByRole('button',{name:'Create account',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('already exists')
  await page.getByRole('tab',{name:'Log in',exact:true}).click()
  await page.getByLabel('Name',{exact:true}).fill(` ${name.toUpperCase()} `)
  await page.getByLabel('Password').fill('New teacher password')
  await page.getByRole('button',{name:'Log in',exact:true}).click()
  await expect(page.locator('.teacher-account-name')).toHaveText(name)
  await page.reload()
  await expect(page.locator('.teacher-account-name')).toHaveText(name)
})
