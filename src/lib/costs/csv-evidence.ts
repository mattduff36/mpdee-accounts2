import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { z } from 'zod'
import { cursorAccounts } from './collector-status'

export const CSV_MAX_BYTES = 3_000_000
export const CSV_MAX_ROWS = 15000
export const cursorCsvHeaders = ['Date','Cloud Agent ID','Automation ID','Kind','Model','Max Mode','Input (w/ Cache Write)','Input (w/o Cache Write)','Cache Read','Output Tokens','Total Tokens','Cost'] as const
export const csvEvidenceRequestSchema = z.object({
  accountEmail: z.enum(cursorAccounts),
  filename: z.string().min(1).max(200).regex(/^[^\\/\x00-\x1f]+\.csv$/i),
  csv: z.string().min(1),
}).strict()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const safeText = (value: string, max: number) => {
  if (value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid text field')
  return value
}
function token(value: string) {
  if (value === '') return null
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid token count')
  return Number(value)
}

export function parseCursorCsv(input: unknown) {
  const request = csvEvidenceRequestSchema.parse(input)
  if (Buffer.byteLength(request.csv, 'utf8') > CSV_MAX_BYTES) throw new Error('CSV exceeds 3 MB')
  const parsed = Papa.parse<string[]>(request.csv.replace(/^\uFEFF/, ''), { skipEmptyLines: true })
  if (parsed.errors.length || !parsed.data.length) throw new Error('Malformed CSV')
  if (JSON.stringify(parsed.data[0]) !== JSON.stringify(cursorCsvHeaders)) throw new Error('Unexpected Cursor CSV headers')
  const sourceRows = parsed.data.slice(1)
  if (!sourceRows.length || sourceRows.length > CSV_MAX_ROWS) throw new Error('CSV must contain between 1 and 15,000 usage rows')
  const unique = new Map<string, ReturnType<typeof parseRow>>()
  for (const row of sourceRows) {
    const event = parseRow(row)
    unique.set(event.fingerprint, event)
  }
  return { accountEmail: request.accountEmail, sourceFile: request.filename, sourceSha256: hash(request.csv), received: sourceRows.length, rows: Array.from(unique.values()) }
}

function parseRow(row: string[]) {
  if (row.length !== cursorCsvHeaders.length) throw new Error('Unexpected CSV field count')
  const [date, cloudAgentId, automationId, kind, model, maxMode, cacheWrite, input, cacheRead, output, total, displayCost] = row
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid UTC event date')
  const occurredAt = new Date(date).toISOString()
  if (occurredAt.slice(0,10) !== date.slice(0,10)) throw new Error('Invalid calendar date')
  if (!kind || !model || !['Yes','No'].includes(maxMode)) throw new Error('Missing usage fields')
  // Keep the provider display string exactly. It is never converted into precise money.
  safeText(displayCost, 80)
  const evidence = {
    version: 'cursor-csv-evidence-v1', timestamp: occurredAt,
    cloudAgentId: safeText(cloudAgentId, 200), automationId: safeText(automationId, 200),
    kind: safeText(kind,100), model: safeText(model,120), maxMode,
    cacheWriteTokens: token(cacheWrite), inputTokens: token(input), cacheReadTokens: token(cacheRead),
    outputTokens: token(output), totalTokens: token(total), displayCost,
    limitations: ['rounded-display-cost','no-conversation-or-workspace','not-financial-ledger'],
  }
  return { fingerprint: hash(JSON.stringify(evidence)), occurredAt: new Date(occurredAt), model: evidence.model, kind: evidence.kind,
    inputTokens: evidence.inputTokens === null ? null : BigInt(evidence.inputTokens), cacheWriteTokens: evidence.cacheWriteTokens === null ? null : BigInt(evidence.cacheWriteTokens),
    cacheReadTokens: evidence.cacheReadTokens === null ? null : BigInt(evidence.cacheReadTokens), outputTokens: evidence.outputTokens === null ? null : BigInt(evidence.outputTokens), totalTokens: evidence.totalTokens === null ? null : BigInt(evidence.totalTokens), evidence }
}
