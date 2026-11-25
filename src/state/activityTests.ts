import type { ActivityTestConfig, TestValue } from '../types.js'

export function isTestValue(value: unknown, depth = 0): value is TestValue {
  if (typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return depth < 12 && Array.isArray(value) && value.every(item => isTestValue(item, depth + 1))
}

export function parseActivityTests(config: ActivityTestConfig) {
  if (!config.spec.trim()) throw new Error('Enter the block name and input placeholders.')
  return parseTestCases(config.cases)
}

export function parseTestCases(text: string) {
  let cases: unknown
  try { cases = JSON.parse(text) }
  catch { throw new Error('Enter valid JSON for the test cases.') }
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 20) throw new Error('Provide between 1 and 20 test cases.')
  return cases.map((item, index): { inputs: TestValue[]; expected: TestValue } => {
    if (!item || !Array.isArray(item.inputs) || !isTestValue(item.inputs) || !isTestValue(item.expected)) {
      throw new Error('Case ' + (index + 1) + ' needs an inputs array and an expected number, text, boolean, or list.')
    }
    return { inputs: item.inputs, expected: item.expected }
  })
}
