import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('students share exercise completion and teachers can review or override it', async ({ page, browser }) => {
  const tag = randomUUID()
  const request = page.request
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Completion teacher ' + tag, password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Completion session ' + tag })
  const path = '/api/sessions/' + session.id
  const group = await post(path + '/groups', { name: 'Test Group' })
  const titles = ['Self finish', 'Review me', 'Test later']
  const methods = ['student', 'teacher', 'project']
  const activityIds: string[] = []
  for (const [index, title] of titles.entries()) {
    const id = randomUUID()
    const response = await request.put('/api/activities/' + id, { data: {
      id, name: title + ' ' + tag, description: '', starterProject: '', estimatedMinutes: 5,
      recoveryPreference: 'ask', completionMethod: methods[index], requirements: [],
    } })
    expect(response.ok(), await response.text()).toBe(true)
    activityIds.push(id)
  }
  const playlistId = randomUUID()
  expect((await request.put('/api/playlists/' + playlistId, { data: { id: playlistId, name: 'Completion playlist ' + tag, description: '', activityIds } })).ok()).toBe(true)
  await post(path + '/assignments', { groupIds: [group.id], kind: 'playlist', id: playlistId })

  const context = await browser.newContext({ baseURL: page.url().startsWith('http') ? new URL(page.url()).origin : 'http://127.0.0.1:4173' })
  try {
    const pupils = [await context.newPage(), await context.newPage()]
    const joins = []
    for (const [index, pupil] of pupils.entries()) {
      const name = 'Completion student ' + index + ' ' + tag
      const joined = await post('/api/participants/join', { joinCode: session.joinCode, name })
      joins.push(joined)
      await pupil.addInitScript(connection => sessionStorage.setItem('classroom.student.v1', JSON.stringify(connection)), {
        sessionId: session.id, token: joined.token, joinCode: session.joinCode, name,
      })
      await pupil.route('**/student-editor.html', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
      await pupil.goto('/student')
    }
    await post(path + '/memberships', { groupId: group.id, participantIds: joins.map(joined => joined.participantId) })
    await page.route('**/student-editor.html*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
    await page.goto('/?view=live&session=' + session.id)

    for (const pupil of pupils) await expect(pupil.getByTestId('student-activity')).toContainText(titles[0])
    await pupils[0].getByRole('button', { name: 'Agree exercise is complete' }).click()
    for(const pupil of pupils){await expect(pupil.getByTestId('student-activity')).toContainText(titles[0]);await expect(pupil.locator('.student-vote-status')).toContainText('1 of 2')}
    await pupils[0].reload()
    await expect(pupils[0].getByRole('button',{name:'Agreement recorded'})).toBeDisabled()
    await pupils[1].getByRole('button',{name:'Agree exercise is complete'}).click()
    for (const pupil of pupils) await expect(pupil.getByTestId('student-activity')).toContainText(titles[1])

    const studentHeaders = { Authorization: 'Bearer ' + joins[0].token }
    const editorPath = '/api/student/editor'
    const project = { groupId: group.id, workspaceKey: activityIds[1], xml: '<project name="Submitted work"></project>' }
    expect((await request.post(editorPath, { headers: studentHeaders, data: project })).ok()).toBe(true)
    await pupils[1].getByRole('button', { name: 'Finish exercise' }).click()
    for (const pupil of pupils) {
      await expect(pupil.getByRole('status')).toContainText('Waiting for teacher review')
      await expect(pupil.locator('.student-editor-under-review')).toHaveAttribute('inert', '')
      await expect(pupil.getByTestId('student-activity')).toContainText(titles[1])
    }
    const frozen = await (await request.get(editorPath, { headers: studentHeaders })).json()
    expect(frozen).toMatchObject({ editable: false, workspaceKey: activityIds[1], editor: { xml: project.xml } })
    expect((await request.post(editorPath, { headers: studentHeaders, data: project })).status()).toBe(409)
    const write = await request.post(editorPath + '/actions', { headers: studentHeaders, data: {
      groupId: group.id, workspaceKey: activityIds[1], revision: frozen.editor.revision, version: -1,
      action: { id: 0, type: 'addVariable', time: 1, args: ['new variable'] },
    } })
    expect(write.status()).toBe(409)
    await page.getByRole('button', { name: 'Alerts (1)' }).click()
    await expect(page.locator('.overview-alerts').getByText('Test Group submitted an exercise')).toBeVisible()
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Activities & Playlists', exact: true }).click()
    const warnings = page.locator('.classroom-notifications').getByRole('button', { name: 'Notices (1)', exact: true })
    if (await warnings.getAttribute('aria-pressed') !== 'true') await warnings.click()
    await page.locator('.classroom-notifications').getByRole('button', { name: 'Review exercise' }).click()
    const sessionDelete = await page.getByRole('button', { name: 'Delete session', exact: true }).boundingBox()
    const counter = await warnings.boundingBox()
    expect(sessionDelete!.x + sessionDelete!.width).toBeLessThan(counter!.x)
    const returnControl = await page.getByRole('button', { name: 'Return for changes' }).boundingBox()
    const popup = await page.locator('.classroom-notification.notice').boundingBox()
    expect(popup!.y).toBeGreaterThan(returnControl!.y + returnControl!.height)
    await page.screenshot({ path: '.local/teacher-review-controls.png' })
    await page.getByRole('button', { name: 'Return for changes' }).click()
    const reviewDialog = page.getByRole('dialog')
    await reviewDialog.getByLabel('Message to group (optional)').fill('Please add a stop command.\nThen try again.')
    await reviewDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    for (const pupil of pupils) await expect(pupil.getByRole('status')).toContainText('Waiting for teacher review')
    await page.getByRole('button', { name: 'Return for changes' }).click()
    await reviewDialog.getByLabel('Message to group (optional)').fill('Please add a stop command.\nThen try again.')
    await reviewDialog.getByRole('button', { name: 'Return for changes', exact: true }).click()
    await expect(reviewDialog).not.toBeVisible()
    for (const pupil of pupils) {
      await expect(pupil.getByRole('region', { name: 'Group chat' })).toContainText('Please add a stop command.')
      await expect(pupil.getByRole('region', { name: 'Group chat' })).toContainText('Returned for changes')
    }
    for (const pupil of pupils) await expect(pupil.getByRole('button', { name: 'Finish exercise' })).toBeVisible()
    expect((await (await request.get(editorPath, { headers: studentHeaders })).json()).editable).toBe(true)
    await pupils[0].getByRole('button', { name: 'Finish exercise' }).click()
    await expect(page.getByText('Waiting for review', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Mark complete' }).click()
    await reviewDialog.getByLabel('Message to group (optional)').fill('Great work, everyone!')
    await reviewDialog.getByRole('button', { name: 'Mark complete', exact: true }).click()
    await expect(reviewDialog).not.toBeVisible()
    for (const pupil of pupils) {
      await expect(pupil.getByRole('region', { name: 'Group chat' })).toContainText('Great work, everyone!')
      await pupil.reload()
      await expect(pupil.getByRole('region', { name: 'Group chat' })).toContainText('Great work, everyone!')
      await expect(pupil.getByRole('region', { name: 'Group chat' })).toContainText('Please add a stop command.')
    }

    for (const pupil of pupils) await expect(pupil.getByTestId('student-activity')).toContainText(titles[2])
    await expect(page.locator('.progress-card .progress-row').filter({hasText:titles[2]})).toContainText('In Progress')
    await page.getByRole('button', { name: 'Mark complete' }).click()
    await reviewDialog.getByRole('button', { name: 'Mark complete', exact: true }).click()
    for (const pupil of pupils) await expect(pupil.getByTestId('student-activity')).toContainText('All assigned exercises completed')
    await expect(page.getByText('3 of 3 completed')).toBeVisible()
  } finally {
    await context.close()
  }
})
