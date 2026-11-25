import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { starterProject } from '../../src/student/starter'

test('NetsBlox reporter results determine whether the group advances', async ({ page, request }) => {
  test.skip(process.env.NETSBLOX_SMOKE !== '1', 'External NetsBlox integration is opt-in')
  test.setTimeout(100000)
  const tag = randomUUID(), id = randomUUID()
  const teacher = page.request
  expect((await teacher.post('/api/teacher/register', { data: { name: 'Autograder ' + tag, password: 'Teacher test password' } })).ok()).toBe(true)
  const { session } = await (await teacher.post('/api/sessions', { data: { name: 'Test cases ' + tag } })).json()
  const path = '/api/sessions/' + session.id
  const group = await (await teacher.post(path + '/groups', { data: { name: 'Test Group' } })).json()
  const spec = "item count %'numbers'"
  const definition = '<block-definition s="item count %&apos;numbers&apos;" type="reporter" category="lists"><inputs><input type="%s"/></inputs>' +
    '<script><block s="doReport"><block s="reportListLength"><block var="numbers"/></block></block></script></block-definition>'
  const activity = { id, name: 'Count exercise ' + tag, description: '', starterProject: starterProject.replace('<blocks><block-definition', '<blocks>' + definition + '<block-definition'),
    recoveryPreference: 'ask', completionMethod: 'project', requirements: [], estimatedMinutes: 5 }
  const save = async (expected: number) => {
    const result = await teacher.put('/api/activities/' + id, { data: {
      ...activity, testConfig: { spec, cases: JSON.stringify([{ inputs: [[2, 4, 6]], expected }, { inputs: [[]], expected: 0 }]) },
    } })
    expect(result.ok(), await result.text()).toBe(true)
  }
  await save(4)
  expect((await (await request.get('/api/state')).json()).activities.find((a: { id: string }) => a.id === id).testConfig).toBeUndefined()
  expect((await teacher.post(path + '/assignments', { data: { groupIds: [group.id], kind: 'activity', id } })).ok()).toBe(true)
  const student = await (await request.post('/api/participants/join', { data: { joinCode: session.joinCode, name: 'Tester ' + tag } })).json()
  expect((await teacher.post(path + '/memberships', { data: { groupId: group.id, participantIds: [student.participantId] } })).ok()).toBe(true)
  const headers = { Authorization: 'Bearer ' + student.token }
  const { activity: current } = await (await request.get('/api/student/state', { headers })).json()
  const submission = await request.post('/api/student/activities/finish', { headers, data: { progressId: current.progressId } })
  expect(submission.ok(), await submission.text()).toBe(true)

  await page.route('**/student-editor.html', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('/?view=live&session=' + session.id)
  const outcome = page.locator('.activity-test-results summary, .netsblox-card [role=alert]').first()
  await expect(outcome).toBeVisible({ timeout: 35000 })
  expect(await outcome.textContent()).toBe('1 of 2 tests passed')
  await expect(page.locator('.activity-test-results')).toContainText('Expected 4 - Reported 3')
  await expect(page.getByRole('button', { name: 'Mark complete' })).toBeVisible()

  await save(3)
  await page.getByRole('button', { name: 'Run tests' }).click()
  await expect(page.getByText('1 of 1 completed')).toBeVisible({ timeout: 40000 })
  await expect(page.getByText('Tests passed', { exact: true })).toBeVisible()
  const final = await (await request.get('/api/student/state', { headers })).json()
  expect(final.finishedAssignedWork).toBe(true)
})
