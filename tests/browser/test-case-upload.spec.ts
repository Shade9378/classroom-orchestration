import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('JSON files populate editable tests, save with the activity, and invalid files preserve existing cases', async ({ page }) => {
  const tag = randomUUID()
  await page.request.post('/api/teacher/register', { data: { name: 'Upload teacher ' + tag, password: 'Teacher test password' } })
  const id = randomUUID()
  const original = [{ inputs: [1], expected: 2 }]
  const spec = "double %'number'"
  const response = await page.request.put('/api/activities/' + id, { data: { id, name: 'Upload exercise ' + tag, description: '', starterProject: '', requirements: [], estimatedMinutes: 5, completionMethod: 'project', testConfig: { spec, cases: JSON.stringify(original) } } })
  expect(response.ok(), await response.text()).toBe(true)
  await page.goto('/?view=activities&activity=' + id)
  const cases = page.getByLabel('Test cases (JSON)', { exact: true })
  const upload = page.getByLabel('Upload test cases', { exact: true })
  await expect(cases).toHaveValue(JSON.stringify(original))
  await expect(page.getByText('Use the exact NetsBlox spec, including input names. Each case needs an inputs list and an expected value.', { exact: true })).toHaveCount(0)
  const imported = [{ inputs: [3], expected: 6 }, { inputs: [7], expected: 14 }]
  await upload.setInputFiles({ name: 'cases.json', mimeType: 'application/json', buffer: Buffer.from('\uFEFF' + JSON.stringify(imported)) })
  await expect.poll(async () => JSON.parse(await cases.inputValue())).toEqual(imported)
  await expect(page.getByLabel('Block name and inputs', { exact: true })).toHaveValue(spec)
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled()
  await page.reload()
  await expect.poll(async () => JSON.parse(await cases.inputValue())).toEqual(imported)
  const saved = await cases.inputValue()
  for (const [name, text, error] of [
    ['bad.json', '{bad json', 'Enter valid JSON'],
    ['wrong.json', '[{"inputs":[1],"expected":{}}]', 'Case 1 needs'],
    ['many.json', JSON.stringify(Array.from({ length: 21 }, () => original[0])), 'between 1 and 20'],
    ['cases.txt', JSON.stringify(imported), 'Choose a JSON'],
  ]) {
    await upload.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
    await expect(page.locator('.activity-test-config [role=alert]')).toContainText(error)
    await expect(cases).toHaveValue(saved)
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled()
  }
})
