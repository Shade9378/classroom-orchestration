import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { simulatorIdentity, simulatorWasConnected, rememberSimulatorConnection } from '../../scripts/simulators/simulatorIdentity.js'

test('named simulator restarts keep registration identity and separate devices get unique IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-sim-'))
  try {
    const options = { directory, servicesUrl: 'https://services.netsblox.org', profile: 'roboscape', name: 'Robot 1' }
    const first = simulatorIdentity(options)
    expect(simulatorIdentity(options)).toEqual(first)
    expect(simulatorIdentity({ ...options, name: 'robot 1' })).toEqual(first)
    expect(simulatorIdentity({ ...options, name: 'Robot 2' }).remoteDeviceId).not.toBe(first.remoteDeviceId)
    expect(first.remoteDeviceId).toMatch(/^[0-9a-f]{12}$/)
    for (const profile of ['galaxy-s23', 'sht40']) {
      const device = simulatorIdentity({ ...options, profile })
      expect(simulatorIdentity({ ...options, profile })).toEqual(device)
      expect(device.serviceName).not.toBe(first.serviceName)
    }
    const existing = simulatorIdentity({ ...options, name: 'Existing robot', deviceId: '020000000001' })
    expect(existing.remoteDeviceId).toBe('020000000001')
    expect(simulatorIdentity({ ...options, name: 'Existing robot' })).toEqual(existing)
    expect(() => simulatorIdentity({ ...options, name: 'Existing robot', deviceId: '020000000002' })).toThrow('already uses device ID')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('a corrupt identity is reported instead of silently creating another device', () => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-sim-'))
  try {
    const options = { directory, servicesUrl: 'https://services.netsblox.org', profile: 'roboscape', name: 'Robot 1' }
    simulatorIdentity(options)
    const file = join(directory, readdirSync(directory)[0])
    writeFileSync(file, 'broken identity')
    expect(() => simulatorIdentity(options)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('broken identity')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('simulator reconnection is remembered independently for each identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-sim-'))
  try {
    const options = { directory, servicesUrl: 'https://services.netsblox.org', profile: 'roboscape', name: 'Robot 1' }
    const first = simulatorIdentity(options), second = simulatorIdentity({ ...options, name: 'Robot 2' })
    expect(simulatorWasConnected(directory, first.id)).toBe(false)
    rememberSimulatorConnection(directory, first.id)
    expect(simulatorWasConnected(directory, simulatorIdentity(options).id)).toBe(true)
    expect(simulatorWasConnected(directory, second.id)).toBe(false)
    rememberSimulatorConnection(directory, first.id)
    expect(simulatorWasConnected(directory, first.id)).toBe(true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
