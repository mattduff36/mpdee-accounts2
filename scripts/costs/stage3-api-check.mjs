import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('D:/Websites/mpdee-accounts2/.env.shadow.real', 'utf8').split(/\r?\n/).filter(line => line.includes('=') && !line.trim().startsWith('#')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const bare = await fetch('http://127.0.0.1:3310/api/costs/projects/itrader/comparison')
const response = await fetch('http://127.0.0.1:3310/api/costs/projects/itrader/comparison', { headers: { authorization: `Bearer ${env.COST_ACCOUNTS_READ_TOKEN}` } })
const body = await response.json()
if (!response.ok) {
  console.log(JSON.stringify({ bare: bare.status, authed: response.status, error: body.error ?? null }))
  process.exit(1)
}
const estimateLines = body.lines.filter(line => line.fx.some(quote => quote.estimate)).length
const paidLines = body.lines.filter(line => line.fx.some(quote => !quote.estimate)).length
const missingFxLines = body.lines.filter(line => line.clientCharge !== null && line.clientChargePence === null).length
const heldLines = body.lines.filter(line => line.held).length
const currencies = new Set(body.lines.map(line => line.currency))
const totalEstimates = body.totals.reduce((sum, row) => sum + row.unresolved.fxEstimateEvents, 0)
const summary = {
  bare: bare.status,
  authed: response.status,
  revision: body.revision,
  events: body.coverage.events,
  held: body.coverage.held,
  unassigned: body.coverage.unassigned,
  fxMissing: body.coverage.fxMissing,
  unionUnresolved: body.coverage.overlap.unionUnresolved,
  outstanding: body.outstanding,
  approvedSnapshot: body.approvedSnapshot,
  currencies: Array.from(currencies),
  totals: body.totals,
  distinct: { estimateLines, paidLines, missingFxLines, heldLines, totalEstimates },
  fxReconciles: estimateLines === totalEstimates && heldLines === body.coverage.held && missingFxLines === body.coverage.fxMissing && body.coverage.overlap.unionUnresolved <= body.coverage.events,
}
writeFileSync('D:/Websites/mpdee-accounts2/docs/costs/live-shadow-stage3-api.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (!summary.fxReconciles || summary.outstanding.pence !== null || summary.approvedSnapshot !== false) process.exit(1)
