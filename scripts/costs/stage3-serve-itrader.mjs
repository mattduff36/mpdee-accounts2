import { spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'

const file = readFileSync('D:/Websites/mpdee-accounts2/.env.shadow.real', 'utf8')
const parsed = Object.fromEntries(file.split(/\r?\n/).filter(line => line.includes('=') && !line.trim().startsWith('#')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const env = { ...process.env }
for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DIRECT_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'VERCEL_ENV']) delete env[key]
env.COST_ACCOUNTS_COMPARISON_ORIGIN = 'http://127.0.0.1:3310'
env.COST_ACCOUNTS_READ_TOKEN = parsed.COST_ACCOUNTS_READ_TOKEN
const log = openSync('D:/Websites/iommarket/.next/shadow-compare.log', 'a')
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-p', '3320', '-H', '0.0.0.0'], {
  cwd: 'D:/Websites/iommarket',
  env,
  detached: true,
  stdio: ['ignore', log, log],
  windowsHide: true,
})
child.unref()
console.log(JSON.stringify({ pid: child.pid, port: 3320, comparisonOrigin: env.COST_ACCOUNTS_COMPARISON_ORIGIN }))
