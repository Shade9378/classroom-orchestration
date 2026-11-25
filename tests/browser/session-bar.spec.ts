import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('session controls fit desktop and mobile widths with long session names', async ({ page }) => {
  const name = 'Classroom session ' + 'A'.repeat(60) + randomUUID().slice(0, 8)
  await page.request.post('/api/teacher/register', { data: { name: 'Session bar teacher ' + randomUUID(), password: 'Session test password' } })
  const { session } = await (await page.request.post('/api/sessions', { data: { name } })).json()
  await page.goto('/?session=' + session.id)
  const bar = page.getByRole('region', { name: 'Classroom session', exact: true })
  for (const width of [1440, 1366, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(bar.getByRole('button', { name: 'Create session', exact: true })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Close session', exact: true })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Delete session', exact: true })).toBeVisible()
    await expect.poll(() => bar.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return element.scrollWidth <= element.clientWidth + 1
        && [...element.querySelectorAll('input, select, button, .session-join')].every(child => {
          const rect = child.getBoundingClientRect()
          return rect.left >= bounds.left && rect.right <= bounds.right + 1
        })
    })).toBe(true)
  }
  await bar.getByRole('button', { name: 'Close session', exact: true }).click()
  await expect(bar.getByRole('button', { name: 'Reopen session', exact: true })).toBeVisible()
  await expect(bar.getByRole('combobox', { name: 'Select session' })).toHaveValue(session.id)
})
