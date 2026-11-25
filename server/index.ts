import { db } from './db.js'
import { buildApp } from './app.js'
const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '127.0.0.1'
const timeoutMs = Number(process.env.HEARTBEAT_TIMEOUT_MS ?? 15000)
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('HEARTBEAT_TIMEOUT_MS must be at least 1000.')
const awayTimeoutMs=Number(process.env.AWAY_TIMEOUT_MS ?? Math.max(timeoutMs,120000))
if(!Number.isInteger(awayTimeoutMs) || awayTimeoutMs<timeoutMs)throw new Error('AWAY_TIMEOUT_MS must be at least HEARTBEAT_TIMEOUT_MS.')
const closeOnExit = process.env.TEACHER_CLOSE_ON_EXIT ?? 'true'
if (!['true', 'false'].includes(closeOnExit)) throw new Error('TEACHER_CLOSE_ON_EXIT must be true or false.')
const localDeviceTesting = process.env.LOCAL_DEVICE_TESTING ?? 'false'
if (!['true', 'false'].includes(localDeviceTesting)) throw new Error('LOCAL_DEVICE_TESTING must be true or false.')
if (localDeviceTesting === 'true' && process.env.NODE_ENV === 'production') throw new Error('Local device testing is disabled in production.')
const { app } = await buildApp(db, { enableLocalDeviceTesting: localDeviceTesting === 'true', teacherExitGraceMs: closeOnExit === 'true' ? 10000 : undefined, timeoutMs, awayTimeoutMs,deviceProvisioningPort:Number(process.env.DEVICE_PROVISIONING_PORT??41234) })
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await app.close(); await db.$disconnect(); process.exit(0) })
try { await db.$connect(); await app.listen({ host, port }); console.log(`Classroom API: http://${host}:${port}`) }
catch (error) { console.error(error); await db.$disconnect(); process.exit(1) }
