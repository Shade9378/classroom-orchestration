import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('All, Notice, Warning and Error filters count and isolate alerts and keep their selection after refresh', async ({ page }) => {
  const tag = randomUUID()
  const post = async (path: string, data: unknown, headers?: Record<string, string>) => {
    const response = await page.request.post(path, { data, headers })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Filter teacher ' + tag, password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Alert class ' + tag })
  const path = '/api/sessions/' + session.id
  const group = await post(path + '/groups', { name: 'Review group' })
  const device = await post(path + '/device-connections/connect', { sourceId: randomUUID(), name: 'Low phone', type: 'Phone', capabilities: ['Phone'], mode: 'bluetooth', profile: 'custom', model: 'Phone', manufacturer: 'Test', battery: 20, degraded: true })
  const offline = await post(path + '/devices', { name: 'Offline robot', type: 'Robot', capabilities: ['Robot'], status: 'OFFLINE' })
  await post(path + '/device-assignments', { groupId: group.id, deviceIds: [device.id, offline.id] })
  const id = randomUUID()
  expect((await page.request.put('/api/activities/' + id, { data: { id, name: 'Review activity ' + tag, description: '', starterProject: '', requirements: [], estimatedMinutes: 5, completionMethod: 'teacher' } })).ok()).toBe(true)
  await post(path + '/assignments', { groupIds: [group.id], kind: 'activity', id })
  const student = await post('/api/participants/join', { joinCode: session.joinCode, name: 'Filter student ' + tag })
  await post(path + '/memberships', { groupId: group.id, participantIds: [student.participantId] })
  const headers = { Authorization: 'Bearer ' + student.token }
  const state = await (await page.request.get('/api/student/state', { headers })).json()
  await post('/api/student/activities/finish', { progressId: state.activity.progressId }, headers)
  await page.route('**/student-editor.html*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('/?view=live&overviewTab=alerts&session=' + session.id)
  const popups = page.getByRole('complementary', { name: 'Classroom notifications' })
  await expect(popups.getByRole('button', { name: 'Notices (1)', exact: true })).toBeVisible()
  for (const category of ['Errors (1)', 'Warnings (2)', 'Notices (1)']) {
    const counter = popups.getByRole('button', { name: category, exact: true })
    if (await counter.getAttribute('aria-pressed') !== 'true') await counter.click()
    await counter.click()
  }
  const filters = page.getByRole('tablist', { name: 'Alert severity' })
  const result = page.getByRole('tabpanel')
  await expect(filters.getByRole('tab', { name: 'All 4', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(result.locator('.alert-card')).toHaveCount(4)
  for (const [name, count, severity] of [['Notice', 1, 'notice'], ['Warning', 2, 'warning'], ['Error', 1, 'error']] as const) {
    await filters.getByRole('tab', { name: name + ' ' + count, exact: true }).click()
    await expect(result.locator('.alert-card')).toHaveCount(count)
    await expect(result.locator('.alert-card.' + severity)).toHaveCount(count)
  }
  await page.reload()
  await expect(filters.getByRole('tab', { name: 'Error 1', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(result.locator('.alert-card.error')).toHaveCount(1)
  await expect(result.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0)
  for (const category of ['Errors (1)', 'Warnings (2)', 'Notices (1)']) {
    const counter = popups.getByRole('button', { name: category, exact: true })
    if (await counter.getAttribute('aria-pressed') !== 'true') await counter.click()
    await counter.click()
  }
  await filters.getByRole('tab', { name: 'Notice 1', exact: true }).click()
  await result.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(filters.getByRole('tab', { name: 'Notice 0', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(popups.getByRole('button', { name: /Notices/ })).toHaveCount(0)
  await page.reload()
  await expect(filters.getByRole('tab', { name: 'Notice 0', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(result).toContainText('No notice alerts')
})
