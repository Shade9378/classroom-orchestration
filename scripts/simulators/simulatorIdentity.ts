import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { robotId } from './netsblox-simulators.js'

const identity = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(100),
  type: z.enum(['Robot', 'Phone', 'Sensor']), mode: z.enum(['roboscape', 'iotscape']),
  serviceName: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100),
  telemetryServiceName: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100).optional(),
  remoteDeviceId: z.string().min(1).max(100), profile: z.string(),
})
type Options = { directory: string; servicesUrl: string; profile: string; name: string; namespace?: string; deviceId?: string }

export function simulatorIdentity(options: Options) {
  const name = z.string().trim().min(1).max(100).parse(options.name)
  if (options.namespace && !/^[A-Za-z][A-Za-z0-9]{0,65}$/.test(options.namespace)) {
    throw new Error('SIMULATOR_NAMESPACE must be alphanumeric and start with a letter.')
  }
  const robot = ['roboscape', 'sphero-bolt'].includes(options.profile)
  if (options.deviceId && (robot ? !/^[0-9a-f]{12}$/.test(options.deviceId) : options.deviceId.length > 100)) {
    throw new Error(robot ? 'Robot device ID must be 12 lowercase hex characters.' : 'Device ID must be at most 100 characters.')
  }
  const key = createHash('sha256').update(JSON.stringify([
    options.servicesUrl.replace(/\/$/, ''), options.profile, name.toLowerCase(), options.namespace ?? '',
  ])).digest('hex')
  mkdirSync(options.directory, { recursive: true })
  const file = join(options.directory, key + '.json')
  const read = () => {
    const saved = identity.parse(JSON.parse(readFileSync(file, 'utf8')))
    if (options.deviceId && saved.remoteDeviceId !== options.deviceId) {
      throw new Error('This named simulator already uses device ID ' + saved.remoteDeviceId + '. Use a different --name to adopt another ID.')
    }
    return saved
  }
  try { return read() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const namespace = options.namespace ?? 'Classroom' + randomBytes(6).toString('hex')
  const saved = identity.parse({
    id: randomUUID(), name, profile: options.profile,
    type: robot ? 'Robot' : options.profile === 'galaxy-s23' ? 'Phone' : 'Sensor',
    mode: robot ? 'roboscape' : 'iotscape',
    serviceName: robot ? 'RoboScape' : namespace + (options.profile === 'galaxy-s23' ? 'Phones' : 'Sensors'),
    ...(robot ? { telemetryServiceName: namespace + 'RobotHealth' } : {}),
    remoteDeviceId: options.deviceId ?? (robot ? robotId() : randomBytes(8).toString('hex')),
  })
  try { writeFileSync(file, JSON.stringify(saved, null, 2), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return read()
}

export function simulatorWasConnected(directory: string, id: string) {
  const file = join(directory, z.string().uuid().parse(id) + '.connected.json')
  try { return z.object({ connected: z.literal(true) }).parse(JSON.parse(readFileSync(file, 'utf8'))).connected }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function rememberSimulatorConnection(directory: string, id: string) {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, z.string().uuid().parse(id) + '.connected.json')
  try { writeFileSync(file, JSON.stringify({ connected: true }), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
}
