import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const env = Object.fromEntries(readFileSync('D:/Websites/mpdee-accounts2/.env.shadow', 'utf8').split(/\r?\n/).filter(line => line.includes('=')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const evidence = 'D:/Websites/mpdee-accounts2/docs/costs/live-shadow-evidence'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const result = { accountsLogin: false, provisional: false, knownUsage: false, unresolvedVisible: false, outstanding: false, dashboardReachable: false, itraderAuthenticated: false, itraderUrl: null }
try {
  const locked = await page.goto('http://127.0.0.1:3310/costs', { waitUntil: 'networkidle' })
  result.lockedStatus = locked?.status() ?? null
  result.lockedUrl = page.url()
  await page.screenshot({ path: `${evidence}/stage2-accounts-login.png`, fullPage: false })
  await page.fill('input[name="email"]', env.SHADOW_LOGIN_EMAIL)
  await page.fill('input[name="password"]', env.SHADOW_LOGIN_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  result.accountsLogin = true
  result.dashboardReachable = page.url().includes('/dashboard')
  await page.goto('http://127.0.0.1:3310/costs?month=2026-10', { waitUntil: 'networkidle', timeout: 60000 })
  const text = await page.locator('body').innerText()
  const section = await page.locator('[aria-label="Shadow comparison"]').innerText()
  result.section = section.slice(0, 1200)
  result.provisional = text.includes('Provisional — invoice blocked')
  result.knownUsage = text.includes('10.0000000')
  result.unresolvedVisible = section.includes('10.0000000') && section.includes('38.6806592') && section.includes('43.6806592') && section.includes('FX estimates') && section.trimEnd().endsWith('No') && section.includes('is not that union')
  result.outstanding = text.includes('£12.34')
  result.overlapNote = text.includes('Do not add unassigned, held and missing-FX counts')
  result.invoiceBlocked = !text.includes('INVOICEABLE')
  await page.screenshot({ path: `${evidence}/stage2-accounts-costs.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${evidence}/stage2-accounts-costs-mobile.png`, fullPage: false })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('http://127.0.0.1:3310/dashboard', { waitUntil: 'networkidle' })
  await page.goto('http://127.0.0.1:3310/costs?month=2026-10', { waitUntil: 'networkidle', timeout: 60000 })
  const again = await page.locator('body').innerText()
  result.consistentAfterDashboard = again.includes('Provisional — invoice blocked') && again.includes('£12.34') && again.includes('10.0000000')
} finally {
  const itrader = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await itrader.goto('http://127.0.0.1:3320/admin/costs', { waitUntil: 'networkidle', timeout: 60000 })
  result.itraderUrl = new URL(itrader.url()).pathname
  result.itraderAuthenticated = result.itraderUrl === '/admin/costs'
  await itrader.screenshot({ path: `${evidence}/stage2-itrader-auth.png`, fullPage: false })
  await browser.close()
}
console.log(JSON.stringify(result, null, 2))
if (!result.accountsLogin || !result.provisional || !result.knownUsage || !result.unresolvedVisible || !result.outstanding || !result.consistentAfterDashboard || result.itraderAuthenticated) process.exit(1)
