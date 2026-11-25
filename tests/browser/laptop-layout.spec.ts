import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('desktop fits the live classroom and bounds every library and assignment panel', async ({ page }) => {
  test.setTimeout(90000)
  const tag = randomUUID()
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await post('/api/teacher/register', { name: 'Laptop teacher ' + tag, password: 'Teacher test password' })
  const { session } = await post('/api/sessions', { name: 'Laptop class ' + tag })
  const path = '/api/sessions/' + session.id
  const groups = []
  for (let index = 1; index <= 8; index++) groups.push(await post(path + '/groups', { name: 'Group ' + index }))
  const activityIds = []
  for (let index = 1; index <= 9; index++) {
    const id = randomUUID()
    activityIds.push(id)
    expect((await page.request.put('/api/activities/' + id, { data: { id, name: 'Laptop exercise ' + index + ' ' + tag, description: 'Lorem ipsum dolor sit amet. '.repeat(12), starterProject: '', requirements: [], recoveryPreference: 'auto', completionMethod: 'teacher', estimatedMinutes: 10 } })).ok()).toBe(true)
  }
  const playlist = { id: randomUUID(), name: 'Laptop playlist ' + tag, description: 'Lorem ipsum '.repeat(30), activityIds }
  expect((await page.request.put('/api/playlists/' + playlist.id, { data: playlist })).ok()).toBe(true)
  await post(path + '/assignments', { groupIds: groups.map(group => group.id), kind: 'playlist', id: playlist.id })
  for (let index = 0; index < 24; index++) {
    const student = await post('/api/participants/join', { joinCode: session.joinCode, name: 'Laptop pupil ' + index + ' ' + tag })
    await post(path + '/memberships', { groupId: groups[index % groups.length].id, participantIds: [student.participantId] })
  }
  for (let index = 0; index < 12; index++) {
    await post(path + '/devices', { name: 'Robot ' + index, type: 'Robot', capabilities: ['Robot'], status: 'OFFLINE' })
    await post(path + '/groups/' + groups[0].id + '/messages', { text: 'A message for the classroom ' + index })
  }
  await page.route('**/student-editor.html*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  const bounds = async (selectors: string[]) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const selector of selectors) for (const panel of await page.locator(selector).all()) {
      const box = await panel.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height, selector).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
    }
  }
  for (const [width, height] of [[1366, 650], [1280, 720], [1440, 800], [1536, 864], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/?view=live&session=' + session.id)
    await expect(page.locator('.live-title-row')).toContainText('Group 1')
    const sessionWidths=await page.locator('.session-action-buttons button').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().width))
    expect(Math.abs(sessionWidths[0]-sessionWidths[1])).toBeLessThan(1)
    await bounds(['.live-main', '.overview-panel', '.live-detail-stack .mini-card'])
    const overview = await page.locator('.overview-panel').boundingBox()
    expect(overview!.height).toBe((await page.locator('.live-main').boundingBox())!.height)
    await page.getByRole('button', { name: 'Students', exact: true }).click()
    await expect(page.locator('.overview-students .student-roster')).toBeVisible()
    await page.getByRole('button', { name: 'Groups', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    expect((await page.locator('.group-editor-canvas').boundingBox())!.height).toBeGreaterThan(200)
    await expect(page.locator('.live-title-row').getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible()
    const controls = await page.locator('.live-header-controls').boundingBox()
    const main = await page.locator('.live-main').boundingBox()
    expect(main!.x + main!.width - controls!.x - controls!.width).toBeLessThan(16)
    await page.getByRole('button',{name:'Devices',exact:true}).click()
    const deviceBounds=await page.locator('.device-overview-table').evaluate(element=>({width:element.clientWidth,content:element.scrollWidth,badgesFit:[...element.querySelectorAll('.group-tag')].every(badge=>badge.getBoundingClientRect().width<=badge.parentElement!.getBoundingClientRect().width+1)}))
    expect(deviceBounds.content).toBeLessThanOrEqual(deviceBounds.width+1)
    expect(deviceBounds.badgesFit).toBe(true)
    await page.getByRole('button',{name:'Groups',exact:true}).click()
    await page.locator('.live-page').screenshot({ path: '.local/laptop-live-' + width + '.png' })
    const libraryWidths: number[] = []
    for (const libraryTab of ['activities', 'playlists']) {
      await page.goto('/?view=activities&libraryTab=' + libraryTab + '&session=' + session.id)
      await expect(page.locator('.activities-page')).toBeVisible()
      await bounds(['.activities-page .panel'])
      for (const panel of await page.locator('.activities-page .panel').all()) {
        const size = await panel.evaluate(element => ({ overflow: getComputedStyle(element).overflowY, height: element.clientHeight, content: element.scrollHeight }))
        expect(size.overflow).toBe('hidden')
        expect(size.content).toBeLessThanOrEqual(size.height + 1)
      }
      if (libraryTab === 'activities') {
        const placement = page.locator('.playlist-placement-panel')
        const fields = page.locator('.playlist-placement-fields')
        const placementSize = await placement.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }))
        expect(placementSize.content).toBeLessThanOrEqual(placementSize.height + 1)
        expect(await fields.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
        expect(await fields.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible')
        const settings = await page.locator('.hardware-time-settings').boundingBox()
        const completion = await page.locator('.activity-settings-grid > .radio-group').boundingBox()
        expect(completion!.x).toBeGreaterThanOrEqual(settings!.x + settings!.width)
        expect(Math.abs(completion!.y - settings!.y)).toBeLessThan(2)
        const actions = page.locator('.activity-editor-actions button')
        await expect(actions.nth(0)).toHaveText('Duplicate')
        await expect(actions.nth(1)).toHaveText('Delete Activity')
        await expect(actions.nth(2)).toHaveText('Save Changes')
        if (width === 1366) {
          await page.locator('input[name=completion]').nth(2).check()
          await expect(page.locator('.activity-test-config textarea')).toBeVisible()
          const font = await page.locator('.activity-test-config textarea').evaluate(element => getComputedStyle(element).fontFamily)
          expect(font).toBe(await page.locator('.activity-editor-fields > .text-input').first().evaluate(element => getComputedStyle(element).fontFamily))
          await page.locator('.activity-test-config').scrollIntoViewIfNeeded()
          await page.locator('.activities-page').screenshot({ path: '.local/activity-settings-tests.png' })
          await page.locator('input[name=completion]').nth(1).check()
        }
      }
      const editorHeader = page.locator('.editor-title-row')
      const headerBefore = await editorHeader.boundingBox()
      const scrollArea = page.locator(libraryTab === 'activities' ? '.activity-editor-fields' : '.playlist-edit-list')
      await scrollArea.evaluate(element => { element.scrollTop = element.scrollHeight })
      expect((await editorHeader.boundingBox())!.y).toBe(headerBefore!.y)
      if (width === 1366) await page.locator('.activities-page').screenshot({ path: '.local/scroll-' + libraryTab + '.png' })
      libraryWidths.push((await page.locator('.library-panel').boundingBox())!.width)
      if (libraryTab === 'playlists') {
        const actions = page.locator('.playlist-editor-actions button')
        await expect(actions.nth(1)).toHaveText('Delete Playlist')
        await expect(actions.nth(2)).toHaveText('Save Playlist')
        const name = await page.locator('.playlist-metadata input').boundingBox()
        const description = await page.locator('.playlist-metadata textarea').boundingBox()
        expect(description!.y).toBeGreaterThan(name!.y + name!.height)
      }
      await expect(page.getByText('Device Recovery', { exact: true })).toHaveCount(0)
    }
    expect(libraryWidths[0]).toBe(libraryWidths[1])
    expect(libraryWidths[0]).toBeGreaterThanOrEqual(280)
    for (const assignmentTab of ['groups', 'resources']) {
      await page.goto('/?view=groups&assignmentTab=' + assignmentTab + '&session=' + session.id)
      await expect(page.locator('.group-page')).toBeVisible()
      await bounds(['.group-page > div > .panel'])
      if (assignmentTab === 'groups') {
        const studentBox=await page.locator('.student-group-column > .assignment-box').boundingBox()
        const workBox=await page.locator('.work-assignment-column > .assignment-box').boundingBox()
        expect(Math.abs(studentBox!.height-workBox!.height)).toBeLessThan(1)
        expect(Math.abs(studentBox!.y-workBox!.y)).toBeLessThan(1)
        await page.getByRole('button', { name: 'Single Activities', exact: true }).click()
        await expect(page.locator('.work-assignment-column .assignment-item').filter({ hasText: 'Laptop exercise' })).toHaveCount(9)
        const scroll = await page.locator('.work-assignment-column').evaluate(element => ({ outerOverflow: getComputedStyle(element).overflowY, outerHeight: element.clientHeight, outerContent: element.scrollHeight, listOverflow: getComputedStyle(element.querySelector('.assignment-list')!).overflowY, groupOverflow: getComputedStyle(element.querySelector('.group-choice-grid')!).overflowY }))
        expect(scroll.outerOverflow).toBe('hidden')
        expect(scroll.outerContent).toBeLessThanOrEqual(scroll.outerHeight + 1)
        expect(scroll.listOverflow).toBe('auto')
        expect(scroll.groupOverflow).toBe('auto')
      }
    }
  }
  await page.goto('/?view=live&session=' + session.id)
  await expect(page.getByRole('button', { name: 'Compact layout', exact: true })).toHaveCount(0)
  await expect(page.locator('.app')).not.toHaveAttribute('data-density')
  await page.reload()
  expect(await page.evaluate(()=>localStorage.getItem('classroom.layout.v1'))).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  await page.goto('/?view=activities&libraryTab=playlists&session=' + session.id)
  const editor = await page.locator('.playlist-editor').evaluate(element => ({ overflow: getComputedStyle(element).overflowY, height: element.clientHeight, content: element.scrollHeight }))
  expect(editor.overflow).toBe('hidden')
  expect(editor.content).toBeLessThanOrEqual(editor.height + 1)
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height })
    for (const query of ['view=activities&libraryTab=activities', 'view=activities&libraryTab=playlists', 'view=groups&assignmentTab=groups', 'view=groups&assignmentTab=resources']) {
      await page.goto('/?' + query + '&session=' + session.id)
      await expect(page.locator('.page-shell')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const panel of await page.locator('.page-shell .panel').all()) expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(height - 23)
      for (const panel of await page.locator('.activities-page .panel').all()) {
        const overflow = await panel.evaluate(element => getComputedStyle(element).overflowY)
        expect(overflow).toBe('hidden')
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 650 })
  await page.goto('/?view=live&overviewTab=devices&session=' + session.id)
  await page.locator('.device-overview-table').getByRole('button', { name: 'View Robot 0 details', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const dialogHeader = dialog.locator('.device-dialog-header')
  const before = await dialogHeader.boundingBox()
  expect(await dialog.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden')
  const deviceListScroll = await dialog.locator('.device-list').evaluate(element => {
    element.scrollTop = element.scrollHeight
    return { height: element.clientHeight, content: element.scrollHeight, top: element.scrollTop }
  })
  expect(deviceListScroll.content).toBeGreaterThan(deviceListScroll.height)
  expect(deviceListScroll.top).toBeGreaterThan(0)
  expect((await dialogHeader.boundingBox())!.y).toBe(before!.y)
  await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
  await dialog.screenshot({ path: '.local/scroll-device-window.png' })
  await dialog.getByRole('button', { name: 'Connect device', exact: true }).click()
  await dialog.getByLabel('Device source', { exact: true }).selectOption('phoneiot')
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close device window', exact: true }).click()
})
