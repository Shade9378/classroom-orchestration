import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import dgram from 'node:dgram'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { DeviceProvisioning } from '../../server/deviceProvisioning.js'

test.each([false, true])('a real simulator resumes without provisioning again (adopt existing ID: %s)', async adopting => {
  const registry = new DeviceProvisioning()
  await registry.start()
  const udp = dgram.createSocket('udp4')
  udp.bind(0, '127.0.0.1')
  await once(udp, 'listening')
  const port = (udp.address() as { port: number }).port
  const announcements: { id: string; service: string }[] = []
  udp.on('message', bytes => {
    const definition = JSON.parse(bytes.toString())
    const service = Object.keys(definition)[0]
    if (definition[service]?.methods) announcements.push({ id: definition[service].id, service })
  })
  const name = 'Restart test ' + randomUUID()
  const base = 'http://127.0.0.1:' + port
  const identityDir = join(process.cwd(), '.local/simulator-identities')
  const key = createHash('sha256').update(JSON.stringify([base, 'sht40', name.toLowerCase(), ''])).digest('hex')
  let child: ChildProcess | undefined
  let deviceId: string | undefined
  let output = ''
  let firstBoot = true
  const existingId = 'existing-' + randomUUID()
  const boot = () => {
    child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/simulators/simulate-device.ts', '--profile', 'sht40', '--name', name, ...(adopting && firstBoot ? ['--device-id', existingId] : [])], {
      cwd: process.cwd(), env: { ...process.env, NETSBLOX_SERVICES_URL: base, IOTSCAPE_PORT: String(port), DEVICE_PROVISIONING_PORT: String(registry.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    firstBoot = false
    child.stdout?.on('data', data => { output += data })
    child.stderr?.on('data', data => { output += data })
  }
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  try {
    boot()
    await vi.waitFor(() => expect(registry.list().some(d => d.name === name)).toBe(true), { timeout: 5000 })
    const first = registry.list().find(d => d.name === name)!
    deviceId = first.id
    if (adopting) expect(first.remoteDeviceId).toBe(existingId)
    else {
      expect(announcements).toHaveLength(0)
      await registry.provision(first.id, base)
    }
    await vi.waitFor(() => expect(announcements).toHaveLength(1), { timeout: 5000 })
    await stop()
    announcements.length = 0
    boot()
    await vi.waitFor(() => expect(announcements.length).toBeGreaterThan(0), { timeout: 5000 })
    expect(announcements[0]).toEqual({ id: first.remoteDeviceId, service: first.serviceName })
    await vi.waitFor(() => expect(output).toContain('connection resumed; the dashboard will detect it automatically'))
  } finally {
    await stop()
    registry.close()
    udp.close()
    rmSync(join(identityDir, key + '.json'), { force: true })
    if (deviceId) rmSync(join(identityDir, deviceId + '.connected.json'), { force: true })
  }
})
