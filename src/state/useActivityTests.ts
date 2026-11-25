import { useActionFeedback } from '../components/ActionFeedback'
import { useEffect, useRef, useState } from 'react'
import type { Activity, Group, TestValue } from '../types'
import { isTestValue } from './activityTests'

type Project = { fingerprint: string; spec: string; xml: string; actions: unknown[]; inputs: TestValue[][] }
type Output = { actual: TestValue } | { error: string }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message ?? 'Could not run activity tests.')
  return result
}

async function executeProject(project: Project): Promise<Output[]> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = 'position: fixed; width: 640px; height: 480px; left: -10000px; top: 0; pointer-events: none'
  iframe.title = 'Activity test runner'
  iframe.sandbox.add('allow-scripts')
  let reply: ((data: Record<string, unknown>) => void) | undefined
  let ready: ((data: Record<string, unknown>) => void) | undefined
  const receive = (event: MessageEvent) => {
    if (event.origin !== 'null' || event.source !== iframe.contentWindow || !event.data) return
    if (event.data.type === 'classroom-reply') reply?.(event.data)
    if (event.data.type === 'classroom-editor-ready' || event.data.type === 'classroom-editor-error') ready?.(event.data)
  }
  const wait = (setup: (accept: (data: Record<string, unknown>) => void) => void, ms = 8000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The NetsBlox test runner did not respond.')), ms)
      setup(data => {
        window.clearTimeout(timer)
        if (typeof data.error === 'string' || data.type === 'classroom-editor-error') {
          reject(new Error(String(data.error ?? data.message ?? 'Could not start NetsBlox.')))
        } else resolve(data)
      })
    })
  const command = (type: string, data: Record<string, unknown>) => wait(accept => {
    const id = crypto.randomUUID()
    reply = message => { if (message.id === id) accept(message) }
    iframe.contentWindow?.postMessage({ id, type, ...data }, '*')
  })
  window.addEventListener('message', receive)
  try {
    await wait(accept => {
      ready = accept
      iframe.src = '/student-editor.html?grading=1'
      document.body.append(iframe)
    }, 20000)
    const outputs: Output[] = []
    for (const inputs of project.inputs) {
      await command('classroom-load', { xml: project.xml, version: -1, shared: true, readOnly: true, actor: 'activity-test' })
      await command('classroom-actions', { actions: project.actions })
      try {
        const { actual } = await command('classroom-test-reporter', { spec: project.spec, inputs })
        if (!isTestValue(actual)) throw new Error('Unsupported reported value.')
        outputs.push({ actual })
      } catch (error) {
        outputs.push({ error: (error as Error).message.slice(0, 400) })
      }
    }
    return outputs
  } finally {
    window.removeEventListener('message', receive)
    iframe.remove()
  }
}

export function useActivityTests(sessionId: string, groups: Group[], activities: Activity[]) {
  const notify = useActionFeedback()
  const attempted = useRef(new Set<string>())
  const working = useRef(false)
  const [running, setRunning] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const run = async (groupId: string, progressId: string, submissionId: string, manual = false) => {
    if (working.current || !sessionId) return
    working.current = true
    attempted.current.add(submissionId)
    setRunning(progressId)
    setErrors(previous => ({ ...previous, [submissionId]: '' }))
    const url = '/api/sessions/' + sessionId + '/groups/' + groupId + '/activity-tests/' + progressId
    try {
      const project = await json<Project>(url)
      const outputs = await executeProject(project)
      const result = await json<{ passed: boolean; cases: { passed: boolean }[] }>(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: project.fingerprint, outputs }),
      })
      if (manual) notify(result.passed ? 'Exercise passed all tests.' : 'Tests completed: '+result.cases.filter(item=>item.passed).length+' of '+result.cases.length+' passed.')
    } catch (error) {
      setErrors(previous => ({ ...previous, [submissionId]: (error as Error).message }))
    } finally {
      working.current = false
      setRunning(null)
    }
  }
  useEffect(() => {
    if (!sessionId || running) return
    for (const group of groups) {
      const progress = group.progress?.find(p => p.status === 'submitted' && p.id && p.submissionId && !p.testResult
        && !attempted.current.has(p.submissionId) && activities.some(a => a.id === p.activityId && a.completionMethod === 'project' && a.testConfig))
      if (progress?.id && progress.submissionId) {
        void run(group.id, progress.id, progress.submissionId)
        return
      }
    }
  })
  return { run, running, errors }
}
