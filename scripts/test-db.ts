import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL first.')
const schema = `test_${randomUUID().replaceAll('-', '')}`
const url = new URL(process.env.DATABASE_URL)
url.searchParams.set('schema', schema)
const db = new PrismaClient()
try {
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  const env = { ...process.env, DATABASE_URL: url.toString(), API_PORT: '3002', HEARTBEAT_TIMEOUT_MS: '2000', VITE_API_TARGET: 'http://127.0.0.1:3002' }
  const migrate = spawnSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env, stdio: 'inherit' })
  if (migrate.status !== 0) throw new Error('Test database migration failed.')
  const result = spawnSync('npm', ['run', process.argv[2] ?? 'test:all', ...(process.argv.length > 3 ? ['--', ...process.argv.slice(3).filter(arg => arg !== '--')] : [])], { env, stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
  await db.$disconnect()
}
