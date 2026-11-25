import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('compact disconnection popup requests explicit approval before assigning a replacement', async ({ page }) => {
  const tag = randomUUID()
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Replacement teacher ' + tag, password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Replacement class ' + tag })
  const path = '/api/sessions/' + session.id
  const group = await post(path + '/groups', { name: 'Group 1' })
  const failed = await post(path + '/devices', { name: 'Robot A', type: 'Robot', capabilities: ['Robot'], status: 'OFFLINE' })
  const spare = await post(path + '/devices', { name: 'Robot B', type: 'Robot', capabilities: ['Robot'], status: 'ONLINE' })
  await post(path + '/device-assignments', { groupId: group.id, deviceIds: [failed.id] })
  await page.goto('/?view=activities&session=' + session.id)
  const notice = page.locator('.classroom-notification.error')
  await expect(notice).toContainText('Robot A (Robot) disconnected')
  await expect(notice.getByRole('button', { name: 'Approve replacement', exact: true })).toBeVisible()
  expect((await notice.boundingBox())!.width).toBeLessThanOrEqual(340)
  expect((await notice.boundingBox())!.height).toBeLessThan(190)
  const state = () => page.request.get('/api/state?sessionId=' + session.id).then(response => response.json())
  expect((await state()).groups.find((item: { id: string }) => item.id === group.id).deviceIds).toEqual([failed.id])
  await page.locator('.classroom-notifications').screenshot({ path: '.local/compact-notification.png' })
  await page.reload()
  await expect(notice.getByRole('button', { name: 'Approve replacement', exact: true })).toBeVisible()
  expect((await state()).groups.find((item: { id: string }) => item.id === group.id).deviceIds).toEqual([failed.id])
  await notice.getByRole('button', { name: 'Approve replacement', exact: true }).click()
  await expect.poll(async () => (await state()).groups.find((item: { id: string }) => item.id === group.id).deviceIds).toEqual([spare.id])
  await expect(notice).toHaveCount(0)
})
