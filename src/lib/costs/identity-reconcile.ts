import { createHash } from 'node:crypto'

export type CursorIdentityFields = {
  accountRef: string
  timestamp: string
  model: string
  conversationId: string | null
  kind: string | null
  isTokenBasedCall: boolean | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export type IdentityRecord = {
  identity: string
  accountRef: string
  projectId: string | null
  funding: string
  nominalUnits: bigint | null
  ambiguous?: boolean
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const tokenFlag = (value: boolean | null) => value === true ? '1' : value === false ? '0' : ''
const fingerprint = (event: CursorIdentityFields) => [event.inputTokens ?? '', event.outputTokens ?? '', event.cacheReadTokens ?? '', event.cacheWriteTokens ?? ''].join(':')

/** iTrader's usage identity. Unknown projects stay null; this never substitutes iTrader. */
export function itraderGroupKey(event: CursorIdentityFields) {
  return [event.accountRef, event.timestamp, event.model, event.conversationId ?? '', event.kind ?? '', tokenFlag(event.isTokenBasedCall)].join('|')
}

export function itraderEventIdentity(groupKey: string, occurrence: number) {
  return sha(`${groupKey}|${occurrence}`)
}

export function assignItraderIdentities<T extends CursorIdentityFields>(events: T[]) {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const key = itraderGroupKey(event)
    const list = groups.get(key) ?? []
    list.push(event)
    groups.set(key, list)
  }
  const assigned: { event: T; identity: string; ambiguous: boolean }[] = []
  for (const [key, items] of Array.from(groups)) {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(fingerprint(item), (counts.get(fingerprint(item)) ?? 0) + 1)
    const ordered = [...items].sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
    ordered.forEach((event, occurrence) => {
      assigned.push({ event, identity: itraderEventIdentity(key, occurrence), ambiguous: (counts.get(fingerprint(event)) ?? 0) > 1 })
    })
  }
  return assigned
}

function sum(rows: IdentityRecord[]) {
  return rows.reduce((total, row) => total + (row.nominalUnits ?? BigInt(0)), BigInt(0)).toString()
}

/** Match ledgers by the shared Cursor identity. Missing and conflicting rows stay visible. */
export function reconcileIdentities(accounts: IdentityRecord[], itrader: IdentityRecord[]) {
  const copies = (rows: IdentityRecord[]) => {
    const seen = new Map<string, number>()
    for (const row of rows) seen.set(row.identity, (seen.get(row.identity) ?? 0) + 1)
    return Array.from(seen).filter(([, count]) => count > 1).map(([identity, count]) => ({ identity, count }))
  }
  const accountsById = new Map(accounts.map(row => [row.identity, row]))
  const itraderById = new Map(itrader.map(row => [row.identity, row]))
  const matched: { identity: string; nominalUnits: string }[] = []
  const conflicting: { identity: string; reason: string; nominalUnits: bigint }[] = []
  const accountsOnly: IdentityRecord[] = []
  for (const row of accounts) {
    if (row.ambiguous) {
      conflicting.push({ identity: row.identity, reason: 'Duplicate source fields; identity is ambiguous', nominalUnits: row.nominalUnits ?? BigInt(0) })
      continue
    }
    const other = itraderById.get(row.identity)
    if (!other) {
      accountsOnly.push(row)
      continue
    }
    if ((row.projectId ?? null) !== (other.projectId ?? null)) conflicting.push({ identity: row.identity, reason: 'Project attribution differs', nominalUnits: row.nominalUnits ?? BigInt(0) })
    else if (row.funding !== other.funding) conflicting.push({ identity: row.identity, reason: 'Funding differs', nominalUnits: row.nominalUnits ?? BigInt(0) })
    else if ((row.nominalUnits ?? null) !== (other.nominalUnits ?? null)) conflicting.push({ identity: row.identity, reason: 'Nominal amount differs', nominalUnits: row.nominalUnits ?? BigInt(0) })
    else matched.push({ identity: row.identity, nominalUnits: (row.nominalUnits ?? BigInt(0)).toString() })
  }
  const itraderOnly = itrader.filter(row => !accountsById.has(row.identity))
  return {
    matched: matched.length,
    matchedNominalUnits: matched.reduce((total, row) => total + BigInt(row.nominalUnits), BigInt(0)).toString(),
    accountsOnly: accountsOnly.length,
    accountsOnlyNominalUnits: sum(accountsOnly),
    itraderOnly: itraderOnly.length,
    itraderOnlyNominalUnits: sum(itraderOnly),
    conflicting: conflicting.length,
    conflictingNominalUnits: conflicting.reduce((total, row) => total + row.nominalUnits, BigInt(0)).toString(),
    conflictReasons: Array.from(conflicting.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>()), ([reason, count]) => ({ reason, count })),
    duplicates: copies(accounts).length + copies(itrader).length,
    forcedProject: null as null,
  }
}

export function explainAccountCoverage(input: { accountRef: string; side: 'accounts' | 'itrader'; nominalUnits: bigint; projectId: string | null }[]) {
  const accounts = new Map<string, { events: number; nominalUnits: bigint; projects: Set<string> }>()
  const itrader = new Set<string>()
  for (const row of input) {
    if (row.side === 'itrader') itrader.add(row.accountRef)
    else {
      const current = accounts.get(row.accountRef) ?? { events: 0, nominalUnits: BigInt(0), projects: new Set<string>() }
      current.events += 1
      current.nominalUnits += row.nominalUnits
      current.projects.add(row.projectId ?? 'unassigned')
      accounts.set(row.accountRef, current)
    }
  }
  const accountsOnly = Array.from(accounts).filter(([account]) => !itrader.has(account)).map(([accountRef, row]) => ({
    accountRef, events: row.events, nominalUnits: row.nominalUnits.toString(), projects: Array.from(row.projects).sort(),
  }))
  return {
    sharedAccounts: Array.from(accounts.keys()).filter(account => itrader.has(account)).length,
    accountsOnly,
    itraderAccountsMissingFromAccounts: Array.from(itrader).filter(account => !accounts.has(account)).length,
    note: 'An account or event with no project mapping stays unassigned. It is not assigned to iTrader.',
  }
}

export type StatusFlags = { unassigned: boolean; held: boolean; fxMissing: boolean }

/** Counts overlap. Unassigned rows are inside held, so the three headlines must not be added. */
export function explainStatusOverlap(rows: StatusFlags[]) {
  let unassigned = 0, held = 0, fxMissing = 0
  let unassignedAndHeld = 0, heldAndFx = 0, unassignedAndFx = 0, allThree = 0
  let union = 0
  for (const row of rows) {
    if (row.unassigned) unassigned += 1
    if (row.held) held += 1
    if (row.fxMissing) fxMissing += 1
    if (row.unassigned && row.held) unassignedAndHeld += 1
    if (row.held && row.fxMissing) heldAndFx += 1
    if (row.unassigned && row.fxMissing) unassignedAndFx += 1
    if (row.unassigned && row.held && row.fxMissing) allThree += 1
    if (row.unassigned || row.held || row.fxMissing) union += 1
  }
  return {
    unassigned, held, fxMissing, union,
    unassignedAndHeld, heldAndFx, unassignedAndFx, allThree,
    addedHeadline: unassigned + held + fxMissing,
    note: 'Do not add unassigned, held and missing-FX counts. Unassigned rows are already included in held.',
  }
}
