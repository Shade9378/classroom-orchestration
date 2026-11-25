import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('teacher chat and help requests are shared, persistent, isolated, and actionable', async ({ page, browser }) => {
  const tag = randomUUID()
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data })
    expect(response.ok(), path + ": " + await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Chat teacher ' + tag, password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Chat class ' + tag })
  const path = '/api/sessions/' + session.id
  const group = await post(path + '/groups', { name: 'Chat group' })
  const other = await post(path + '/groups', { name: 'Other group' })
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    await context.route('**/student-editor.html*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
    const pupils = [await context.newPage(), await context.newPage(), await context.newPage()]
    const joins = []
    for (const [index, pupil] of pupils.entries()) {
      const name = 'Chat student ' + index
      const joined = await post('/api/participants/join', { joinCode: session.joinCode, name })
      joins.push(joined)
      await pupil.addInitScript(connection => sessionStorage.setItem('classroom.student.v1', JSON.stringify(connection)), {
        sessionId: session.id, token: joined.token, joinCode: session.joinCode, name,
      })
      await pupil.goto('/student')
    }
    await post(path + '/memberships', { groupId: group.id, participantIds: joins.slice(0, 2).map(j => j.participantId) })
    await post(path + '/memberships', { groupId: other.id, participantIds: [joins[2].participantId] })
    await page.route('**/student-editor.html*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
    await page.goto('/?view=live&session=' + session.id)
    const chat = page.getByRole('region', { name: 'Group chat' })
    await chat.getByRole('textbox', { name: 'Group message' }).fill('Hello from your teacher')
    await chat.getByRole('button', { name: 'Send to group' }).click()
    for (const pupil of pupils.slice(0, 2)) await expect(pupil.getByRole('list', { name: 'Group messages' })).toContainText('Hello from your teacher')
    await expect(pupils[2].getByRole('list', { name: 'Group messages' })).toBeEmpty()
    await pupils[0].getByRole('textbox', { name: 'Group message' }).fill('We can see it!')
    await pupils[0].getByRole('button', { name: 'Send to group' }).click()
    await expect(chat).toContainText('We can see it!')
    await pupils[1].reload()
    await expect(pupils[1].getByRole('list', { name: 'Group messages' })).toContainText('Hello from your teacher')
    await page.reload()
    await expect(chat).toContainText('We can see it!')
    const box = await chat.boundingBox()
    const events = await page.locator('.recent-events-card').boundingBox()
    expect(box!.height).toBe(events!.height)
    expect(box!.width).toBe(events!.width)
    expect(box!.y).toBeGreaterThan((await page.locator('.progress-card').boundingBox())!.y)
    await pupils[0].getByRole('button', { name: 'Request help', exact: true }).click()
    await pupils[0].getByLabel('Help message', { exact: true }).fill('Our robot is stuck')
    await pupils[0].getByRole('button', { name: 'Send help request' }).click()
    for (const pupil of pupils.slice(0, 2)) await expect(pupil.getByText('Your group has requested help.', { exact: false })).toBeVisible()
    await expect(page.locator('.classroom-notifications')).toContainText('Chat group needs help')
    await expect(page.locator('.classroom-notifications')).toContainText('Our robot is stuck')
    await page.locator('.classroom-notifications').getByRole('button', { name: 'View group chat' }).click()
    await expect(chat).toContainText('Our robot is stuck')
    const duplicate = await page.request.post('/api/student/help', { headers: { Authorization: 'Bearer ' + joins[1].token }, data: { text: 'Another request' } })
    expect(duplicate.status()).toBe(409)
    await chat.getByRole('button', { name: 'Mark help resolved' }).click()
    await expect(page.locator('.classroom-notifications')).not.toContainText('Chat group needs help')
    for (const pupil of pupils.slice(0, 2)) await expect(pupil.getByRole('button', { name: 'Request help', exact: true })).toBeVisible()
    await expect(chat).toContainText('Help request resolved')
    await page.locator('.live-detail-stack').screenshot({ path: '.local/chat-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(chat).toBeVisible()
    expect((await chat.boundingBox())!.height).toBe(140)
    expect((await chat.boundingBox())!.width).toBe((await page.locator('.recent-events-card').boundingBox())!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.live-detail-stack').screenshot({ path: '.local/chat-mobile.png' })
  } finally { await context.close() }
})
