import { spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'
import { assertRealShadow } from './shadow-target'

const file = readFileSync('D:/Websites/mpdee-accounts2/.env.shadow.real', 'utf8')
const env = { ...process.env }
for (const line of file.split(/\r?\n/)) {
  const index = line.indexOf('=')
  if (index < 1 || line.trim().startsWith('#')) continue
  env[line.slice(0, index)] = line.slice(index + 1)
}
delete env.VERCEL_ENV
assertRealShadow(env.DATABASE_URL)
const log = openSync('D:/Websites/mpdee-accounts2/.next/shadow-real.log', 'a')
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3310', '-H', '0.0.0.0'], {
  cwd: 'D:/Websites/mpdee-accounts2',
  env,
  detached: true,
  stdio: ['ignore', log, log],
  windowsHide: true,
})
child.unref()
console.log(JSON.stringify({ url: 'http://127.0.0.1:3310/costs', pid: child.pid, database: '127.0.0.1:54329/mpdee_accounts_shadow_real' }))
