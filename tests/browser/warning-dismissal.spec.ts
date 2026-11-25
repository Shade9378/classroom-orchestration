import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('warnings and review notices stay dismissed after refresh for the signed-in teacher', async ({ page, browser }) => {
  const post = async (path: string, data: unknown, headers?: Record<string, string>) => {
    const response = await page.request.post(path, { data, headers })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Dismiss teacher ' + randomUUID(), password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Dismiss warnings ' + randomUUID() })
  const path = '/api/sessions/' + session.id
  const group = await post(path + '/groups', { name: 'Review group' })
  const device = await post(path + '/device-connections/connect', {
    sourceId: randomUUID(), name: 'Low phone', type: 'Phone', capabilities: ['Phone'], mode: 'bluetooth',
    profile: 'custom', model: 'Phone', manufacturer: 'Test', battery: 20, degraded: true,
  })
  await post(path + '/device-assignments', { groupId: group.id, deviceIds: [device.id] })
  const id = randomUUID()
  expect((await page.request.put('/api/activities/' + id, { data: {
    id, name: 'Review exercise ' + id, description: '', starterProject: '', requirements: [],
    estimatedMinutes: 5, recoveryPreference: 'ask', completionMethod: 'teacher',
  } })).ok()).toBe(true)
  await post(path + '/assignments', { groupIds: [group.id], kind: 'activity', id })
  const joined = await post('/api/participants/join', { joinCode: session.joinCode, name: 'Dismiss pupil ' + randomUUID() })
  await post(path + '/memberships', { groupId: group.id, participantIds: [joined.participantId] })
  const headers = { Authorization: 'Bearer ' + joined.token }
  const studentState = await (await page.request.get('/api/student/state', { headers })).json()
  await post('/api/student/activities/finish', { progressId: studentState.activity.progressId }, headers)
  await page.route('**/student-editor.html', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('/?view=live&overviewTab=alerts&session=' + session.id)
  const popups = page.getByRole('complementary', { name: 'Classroom notifications' })
  const warnings = popups.locator('.classroom-notification')
  await expect(popups.getByRole('button', { name: 'Warnings (2)', exact: true })).toBeVisible()
  await popups.getByRole('button', { name: 'Warnings (2)', exact: true }).click()
  await popups.getByRole('button', { name: 'Notices (1)', exact: true }).click()
  let releaseDismissal: () => void = () => {}
  const heldDismissal = new Promise<void>(resolve => { releaseDismissal = resolve })
  let delayFirstDismissal = true
  await page.route('**' + path + '/warning-dismissals', async route => {
    if (delayFirstDismissal) {
      delayFirstDismissal = false
      await heldDismissal
    }
    await route.continue()
  })
  for (const title of ['Low phone (Phone) battery low', 'Low phone (Phone) connection degraded', 'Review group submitted an exercise']) {
    const popup = warnings.filter({ hasText: title })
    const dismiss = popup.getByRole('button', { name: 'Dismiss ' + (title.startsWith('Review group') ? 'notice' : 'warning') + ': ' + title, exact: true })
    await expect(dismiss).toHaveText('Dismiss')
    await expect(dismiss.locator('..').getByRole('button', { name: 'View alerts', exact: true })).toBeVisible()
    await dismiss.click()
    await expect(page.locator('.overview-alerts')).not.toContainText(title)
    if (title === 'Low phone (Phone) battery low') {
      await expect(popups.getByRole('button', { name: 'Warnings (1)', exact: true })).toBeVisible()
      releaseDismissal()
    }
    await expect.poll(async () => (await (await page.request.get('/api/state?sessionId=' + session.id)).json()).dismissedWarningKeys.length)
      .toBe(['Low phone (Phone) battery low', 'Low phone (Phone) connection degraded', 'Review group submitted an exercise'].indexOf(title) + 1)
    await page.reload()
    await expect(page.locator('.overview-alerts')).not.toContainText(title)
  }
  await expect(popups.getByRole('button', { name: /Warnings|Notices/ })).toHaveCount(0)
  const snapshot = await (await page.request.get('/api/state?sessionId=' + session.id)).json()
  expect(snapshot.dismissedWarningKeys).toHaveLength(3)
  expect((await page.request.post(path + '/warning-dismissals', { data: { fingerprint: snapshot.dismissedWarningKeys[0] } })).ok()).toBe(true)
  expect((await (await page.request.get('/api/state?sessionId=' + session.id)).json()).dismissedWarningKeys).toHaveLength(3)
  const error = await page.request.post(path + '/warning-dismissals', { data: { fingerprint: JSON.stringify(['error-device', 'error', 'Disconnected', null]) } })
  expect(error.status()).toBe(400)

  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    await other.request.post('/api/teacher/register', { data: { name: 'Other dismissal teacher ' + randomUUID(), password: 'Teacher test password' } })
    const ownSnapshot = await (await other.request.get('/api/state?sessionId=' + session.id)).json()
    expect(ownSnapshot.dismissedWarningKeys).toEqual([])
  } finally {
    await other.close()
  }

  const report = (battery: number, degraded: boolean) => post('/api/device-connections/' + device.id + '/heartbeat',
    { connected: true, battery, degraded }, { Authorization: 'Bearer ' + device.token })
  await report(80, false)
  await expect.poll(async () => (await (await page.request.get('/api/state?sessionId=' + session.id)).json()).dismissedWarningKeys.length).toBe(1)
  await report(20, true)
  await expect(popups.getByRole('button', { name: 'Warnings (2)', exact: true })).toBeVisible()
  await expect(warnings.filter({ hasText: 'Low phone (Phone) battery low' }).locator('.notification-new')).toHaveText('New')
  await expect(warnings.filter({ hasText: 'Low phone (Phone) connection degraded' }).locator('.notification-new')).toHaveText('New')
  await expect(page.locator('.overview-alerts')).not.toContainText('Review group submitted an exercise')
})
