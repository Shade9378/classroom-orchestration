import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('remove device sends a valid empty DELETE and removes the saved connection', async ({ page }) => {
  const request = page.request
  await request.post('/api/teacher/register', { data: { name: 'Remove teacher ' + randomUUID(), password: 'Remove test password' } })
  const { session } = await (await request.post('/api/sessions', { data: { name: 'Remove class ' + randomUUID() } })).json()
  const path = '/api/sessions/' + session.id
  const group = await (await request.post(path + '/groups', { data: { name: 'Group 1' } })).json()
  const device = await (await request.post(path + '/devices', { data: { name: 'Remove robot', type: 'Robot', capabilities: ['Robot'], status: 'OFFLINE' } })).json()
  await request.post(path + '/device-assignments', { data: { groupId: group.id, deviceIds: [device.id] } })
  await page.goto('/?view=live&overviewTab=devices&session=' + session.id)
  await page.locator('.device-overview-table').getByRole('button', { name: 'View Remove robot details', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const deletion = page.waitForResponse(response => response.request().method() === 'DELETE'
    && response.url().endsWith('/device-connections/' + device.id))
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  const response = await deletion
  expect(response.status(), await response.text()).toBe(200)
  expect(response.request().headers()['content-type']).toBeUndefined()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const snapshot = await (await request.get('/api/state?sessionId=' + session.id)).json()
  expect(snapshot.devices).toHaveLength(0)
  expect(snapshot.groups[0].deviceIds).toHaveLength(0)
})
