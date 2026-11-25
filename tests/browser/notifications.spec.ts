import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('new popups fade, clicking during a fade pins the whole category across tabs', async ({ page }) => {
  await page.request.post('/api/teacher/register', { data: { name: 'Popup teacher ' + randomUUID(), password: 'Teacher password' } })
  const { session } = await (await page.request.post('/api/sessions', { data: { name: 'Popup class ' + randomUUID() } })).json()
  const snapshot = await (await page.request.get('/api/state?sessionId=' + session.id)).json()
  const device = { id: randomUUID(), name: 'Robot A', type: 'Robot', capability: 'Robot', status: 'online', batteryLevel: 20 }
  const devices = [device]
  const group = { id: randomUUID(), name: 'Group 1', status: 'idle', studentIds: [], deviceIds: [device.id], progress: [] }
  const dismissed: string[] = []
  await page.route('**/api/sessions/' + session.id + '/warning-dismissals', route => {
    dismissed.push(route.request().postDataJSON().fingerprint)
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/state?sessionId=' + session.id, route =>
    route.fulfill({ json: { ...snapshot, dismissedWarningKeys: dismissed, devices, groups: [group] } }))

  const publish = async () => {
    const response = await page.request.post('/api/sessions/' + session.id + '/devices', {
      data: { name: randomUUID(), type: 'Sensor', capabilities: ['Humidity Sensor'] },
    })
    expect(response.ok()).toBe(true)
  }
  await page.clock.install()
  await page.goto('/?view=activities&session=' + session.id)
  const notifications = page.getByRole('complementary', { name: 'Classroom notifications' })
  const warnings = notifications.locator('.classroom-notification.warning')
  const errors = notifications.locator('.classroom-notification.error')
  const warningButton = () => notifications.getByRole('button', { name: /Warnings \(/ })
  const errorButton = () => notifications.getByRole('button', { name: /Errors \(/ })
  await expect(warnings).toContainText('Robot A (Robot) battery low')
  await expect(warnings.locator('.notification-new')).toHaveText('New')
  const signOut = await page.getByRole('button', { name: 'Sign out', exact: true }).boundingBox()
  const position = await notifications.boundingBox()
  expect(position!.y).toBeGreaterThan(signOut!.y + signOut!.height)

  await page.clock.fastForward(8000)
  await expect(warnings).toHaveClass(/fading/)
  await warningButton().click()
  await expect(warningButton()).toHaveAttribute('aria-pressed', 'true')
  await expect(warnings).not.toHaveClass(/fading/)
  await page.clock.fastForward(30000)
  await expect(warnings).toBeVisible()

  devices.push({ id: randomUUID(), name: 'Phone B', type: 'Phone', capability: 'Phone', status: 'online', batteryLevel: 10 })
  await publish()
  await expect(warningButton()).toHaveText('2')
  await expect(warnings).toHaveCount(2)
  await expect(warnings.filter({ hasText: 'Phone B' }).locator('.notification-new')).toBeVisible()
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Group Assignments', exact: true }).click()
  await page.clock.fastForward(30000)
  await expect(warnings).toHaveCount(2)
  await warningButton().click()
  await expect(warnings.first()).toBeHidden()
  await expect(warningButton()).toHaveAttribute('aria-pressed', 'false')

  devices.push({ id: randomUUID(), name: 'Sensor C', type: 'Sensor', capability: 'Humidity Sensor', status: 'online', batteryLevel: 10 })
  await publish()
  await expect(warningButton()).toHaveText('3')
  await expect(warnings.filter({ hasText: 'Sensor C' })).toBeVisible()
  await expect(warnings.filter({ hasText: 'Phone B' })).toBeHidden()
  await page.clock.fastForward(8500)
  await expect(warningButton()).toHaveAttribute('aria-expanded', 'false')
  await warningButton().click()
  await expect(warnings).toHaveCount(3)
  await warnings.filter({ hasText: 'Sensor C' }).getByRole('button', { name: /Dismiss warning/ }).click()
  await expect(warnings).toHaveCount(2)
  await expect(warningButton()).toHaveText('2')

  device.status = 'offline'
  await publish()
  await expect(errors).toContainText('Robot A (Robot) disconnected')
  await expect(errors.getByRole('button', { name: /Dismiss/ })).toHaveCount(0)
  await expect(errorButton()).toHaveText('1')
  await expect(warningButton()).toHaveText('1')
  await page.clock.fastForward(8500)
  await expect(errorButton()).toHaveAttribute('aria-expanded', 'false')
  await errorButton().click()
  await expect(errors).toBeVisible()
  await page.clock.fastForward(30000)
  await expect(errors).toBeVisible()
  await errors.getByRole('button', { name: 'View alerts' }).click()
  await expect(page.locator('.overview-alerts')).toContainText('Robot A (Robot) disconnected')
  await expect(errors).toBeVisible()
  await errorButton().click()

  device.status = 'online'
  devices.forEach(item => { item.batteryLevel = 80 })
  await publish()
  await expect(errorButton()).toHaveCount(0)
  await expect(warningButton()).toHaveCount(0)
})

test('notification controls stay fixed on the right at desktop and phone widths', async ({ page }) => {
  await page.request.post('/api/teacher/register', { data: { name: 'Fixed controls ' + randomUUID(), password: 'Teacher password' } })
  const { session } = await (await page.request.post('/api/sessions', { data: { name: 'Fixed classroom ' + randomUUID() } })).json()
  const state = await (await page.request.get('/api/state?sessionId=' + session.id)).json()
  state.devices = [
    { id: randomUUID(), name: 'Phone', type: 'Phone', status: 'online', capability: 'Phone', batteryLevel: 20 },
    { id: randomUUID(), name: 'Robot', type: 'Robot', status: 'online', capability: 'Robot', batteryLevel: 4 },
  ]
  await page.route('**/api/state?sessionId=' + session.id, route => route.fulfill({ json: state }))
  await page.goto('/?view=activities&session=' + session.id)
  const controls = page.getByRole('complementary', { name: 'Classroom notifications' })
  await expect(controls.getByRole('button', { name: 'Move notifications' })).toHaveCount(0)
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 700 }]) {
    await page.setViewportSize(viewport)
    await expect(controls.getByRole('button', { name: 'Errors (1)' })).toBeVisible()
    await expect(controls.getByRole('button', { name: 'Warnings (1)' })).toBeVisible()
    await expect.poll(async () => {
      const bounds = (await controls.boundingBox())!
      const header = (await page.getByRole('banner').boundingBox())!
      const gap = viewport.width - bounds.x - bounds.width
      return bounds.x >= 0 && gap >= 15 && gap <= 21 && bounds.y >= header.y + header.height
    }).toBe(true)
  }
  expect((await page.request.get('/api/teacher/notification-position')).status()).toBe(404)
  expect((await page.request.put('/api/teacher/notification-position', { data: { x: 0, y: 0 } })).status()).toBe(404)
})
