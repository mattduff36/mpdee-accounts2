'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  MANUAL_ALLOCATION_VERSION, allocatedSourceAmounts, allocationSharesSchema, percentageBps,
  type AllocationShare, type ManualAllocationState, type ManualSourceKind,
} from '@/lib/costs/manual-allocation'

type Props = {
  sourceKind: ManualSourceKind
  sourceId: string
  currency: string
  amountMinor: number
  gbpEstimatePence: number | null
  initial: ManualAllocationState
  projects: { id: string; name: string; archived: boolean }[]
  writable: boolean
}
const input = 'rounded-lg border border-slate-300 bg-white p-2 text-slate-900'
const money = (currency: string, minor: number) => `${currency} ${(minor / 100).toFixed(2)}`

export function ManualAllocationEditor(props: Props) {
  const router = useRouter()
  const nextKey = useRef(props.initial.shares.length)
  const [rows, setRows] = useState(props.initial.shares.map((share, key) => ({
    key, projectId: share.projectId, percent: (share.shareBps / 100).toFixed(2),
  })))
  const [revision, setRevision] = useState(props.initial.revision)
  const [busy, setBusy] = useState(false)
  const [conflicted, setConflicted] = useState(false)
  const [message, setMessage] = useState('')
  const shares = rows.map(row => ({ projectId: row.projectId, shareBps: percentageBps(row.percent) ?? -1 }))
  const parsed = allocationSharesSchema.safeParse(shares)
  const total = shares.reduce((sum, share) => sum + Math.max(0, share.shareBps), 0)
  const preview = parsed.success ? allocatedSourceAmounts(props.amountMinor, props.gbpEstimatePence, {
    revision, basis: 'user_selected', shares: parsed.data, unallocatedBps: 10000 - total,
  }) : null
  function update(key: number, change: Partial<{ projectId: string; percent: string }>) {
    setRows(current => current.map(row => row.key === key ? { ...row, ...change } : row))
  }
  function assignRemaining(key: number) {
    const other = rows.filter(row => row.key !== key).map(row => percentageBps(row.percent))
    if (other.some(value => value === null)) { setMessage('Enter valid percentages before assigning the remainder.'); return }
    const remaining = 10000 - other.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    if (remaining <= 0) { setMessage('No percentage remains for this project.'); return }
    update(key, { percent: (remaining / 100).toFixed(2) })
    setMessage('')
  }
  async function save(nextShares: AllocationShare[]) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/costs/manual-allocations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: MANUAL_ALLOCATION_VERSION, sourceKind: props.sourceKind, sourceId: props.sourceId,
          expectedRevision: revision, shares: nextShares,
        }),
      })
      const result: { error?: string; revision?: number } = await response.json()
      if (!response.ok) {
        setMessage(result.error ?? 'Allocation was not saved.')
        if (response.status === 409) setConflicted(true)
        return
      }
      if (typeof result.revision !== 'number' || !Number.isInteger(result.revision)) throw new Error('Missing saved revision')
      setRevision(result.revision)
      if (!nextShares.length) setRows([])
      setMessage('Saved user-selected allocation. Source cost and financial totals are unchanged.')
      router.refresh()
    } catch {
      setMessage('Save could not be confirmed. Reload current values before trying again.')
      setConflicted(true)
    } finally { setBusy(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (parsed.success) void save(parsed.data)
  }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 text-sm">
    <h3 className="font-semibold text-slate-900">Project allocation (user-selected, not measured usage)</h3>
    <p className="mt-1 text-slate-600">{props.sourceKind === 'subscription_invoice'
      ? 'Applies to this invoice only. Future invoices start unallocated.'
      : 'Ongoing split of this monthly commitment, not proof of payment. Until an explicit split is saved, its original single project receives 100%.'}</p>
    <p className="mt-1 text-xs text-slate-500">Saved revision {revision}. {props.initial.basis === 'legacy_single_project_default' && revision === 0 ? 'Using the existing single-project default.' : revision > 0 ? 'Explicit user-selected override; an empty split stays wholly unallocated.' : 'No allocation saved.'}</p>
    {props.writable && <form onSubmit={submit} className="mt-4 space-y-3">
      <fieldset disabled={busy || conflicted} className="space-y-3">
        {rows.map(row => <div key={row.key} className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1">Project<select className={`${input} mt-1 w-full`} value={row.projectId} onChange={event => update(row.key, { projectId: event.target.value })} required>
            <option value="">Choose an Accounts project</option>
            {props.projects.map(project => <option key={project.id} value={project.id} disabled={rows.some(other => other.key !== row.key && other.projectId === project.id)}>
              {project.name}{project.archived ? ' (archived)' : ''}
            </option>)}
          </select></label>
          <label>Percent<input className={`${input} mt-1 block w-28`} type="number" min="0.01" max="100" step="0.01" value={row.percent} onChange={event => update(row.key, { percent: event.target.value })} required /></label>
          <button type="button" disabled={!row.projectId} onClick={() => assignRemaining(row.key)} className="rounded-lg border px-3 py-2 disabled:opacity-50">Assign remaining here</button>
          <button type="button" onClick={() => setRows(current => current.filter(other => other.key !== row.key))} className="rounded-lg border px-3 py-2">Remove</button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={rows.length >= 100 || rows.length >= props.projects.length} onClick={() => setRows(current => [...current, { key: nextKey.current++, projectId: '', percent: '' }])} className="rounded-lg border px-3 py-2 disabled:opacity-50">Add project</button>
          <button type="submit" disabled={!parsed.success} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save allocation'}</button>
          <button type="button" onClick={() => void save([])} className="rounded-lg border px-3 py-2">Clear / save wholly unallocated</button>
        </div>
      </fieldset>
      {!parsed.success && <p role="alert" className="text-amber-800">Choose unique projects with percentages above zero, up to two decimal places, totalling at most 100%.</p>}
    </form>}
    <p className="mt-3 font-medium">Unallocated remainder: {parsed.success ? `${((10000 - total) / 100).toFixed(2)}%` : 'fix percentages to preview'}</p>
    {preview && <div className="mt-2 overflow-x-auto"><table className="w-full text-left">
      <caption className="sr-only">Conserving allocation preview</caption>
      <thead><tr><th className="p-2">Project</th><th className="p-2">Share</th><th className="p-2">Native gross / monthly rate</th><th className="p-2">Reference GBP</th></tr></thead>
      <tbody>{preview.map(bucket => <tr key={bucket.projectId ?? 'unallocated'} className="border-t">
        <td className="p-2">{bucket.projectId === null ? 'Unallocated' : props.projects.find(project => project.id === bucket.projectId)?.name ?? bucket.projectId}</td>
        <td className="p-2">{(bucket.shareBps / 100).toFixed(2)}%</td>
        <td className="p-2">{money(props.currency, bucket.amountMinor)}</td>
        <td className="p-2">{bucket.gbpEstimatePence === null ? 'Unavailable (no stored reference FX)' : money('GBP', bucket.gbpEstimatePence)}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="mt-2 text-xs text-slate-500">Preview includes the remainder and conserves each integer total. GBP is an estimate, not a bank settlement. No expenses, client prices or invoices are created.</p>
    {message && <p role="status" className="mt-2 text-slate-700">{message}</p>}
    {conflicted && <button type="button" onClick={() => window.location.reload()} className="mt-2 text-blue-700 underline">Reload current allocation before editing</button>}
  </section>
}
