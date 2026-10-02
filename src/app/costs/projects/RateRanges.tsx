'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deletePolicyRange, savePolicyRange, type SaveResult } from './actions'
import { buttonClass, inputClass } from '../ui'
import { coverageEnd, parseUtcDate, type RateRange } from '@/lib/costs/project-matrix'

export type RatePolicy = { id: string; projectId: string | null; clientId: string | null; effectiveAt: string; effectiveUntil: string | null; billable: boolean; includedBaseBps: number; markupBps: number; infrastructureMarkupBps: number; vercelDailyPence: number }
type Draft = { effectiveAt: string; effectiveUntil: string; billable: boolean; includedBase: string; markup: string; infrastructureMarkup: string; vercelDaily: string }
const pounds = (pence: number) => (pence / 100).toFixed(2)
const asRange = (policy: RatePolicy): RateRange => ({ effectiveAt: parseUtcDate(policy.effectiveAt), effectiveUntil: policy.effectiveUntil ? parseUtcDate(policy.effectiveUntil) : null })
export function rangeEnd(policy: RatePolicy, peers: RatePolicy[]) {
  const end = coverageEnd(asRange(policy), peers.map(asRange))
  return end ? end.toISOString().slice(0, 10) : null
}
function draftFrom(policy: RatePolicy | undefined, today: string): Draft {
  return { effectiveAt: policy?.effectiveAt ?? today, effectiveUntil: policy?.effectiveUntil ?? '', billable: policy?.billable ?? false, includedBase: String((policy?.includedBaseBps ?? 5000) / 100), markup: String((policy?.markupBps ?? 0) / 100), infrastructureMarkup: String((policy?.infrastructureMarkupBps ?? 0) / 100), vercelDaily: pounds(policy?.vercelDailyPence ?? 0) }
}
export function RateRanges({ name, projectId, clientId, policies, onClose }: { name: string; projectId: string | null; clientId: string | null; policies: RatePolicy[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<SaveResult | null>(null)
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState<RatePolicy | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(policies[0], today))
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal() }, [])
  const latest = [...policies].sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0]
  const ordered = [...policies].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
  const openForm = (policy: RatePolicy | undefined, edit: boolean) => {
    const template = draftFrom(policy ?? latest, today)
    setSelected(policy?.id ?? null)
    setEditing(edit)
    setDraft(policy ? template : { ...template, effectiveAt: today, effectiveUntil: '' })
    setMessage(null)
  }
  const save = () => startTransition(async () => {
    const result = await savePolicyRange({ id: selected ?? null, projectId, clientId, ...draft, effectiveUntil: draft.effectiveUntil || null })
    setMessage(result)
    if (result.ok) { setSelected(undefined); setEditing(false); setConfirming(null); router.refresh() }
  })
  const remove = (policy: RatePolicy) => startTransition(async () => {
    const result = await deletePolicyRange({ id: policy.id, projectId, clientId })
    setMessage(result)
    setConfirming(null)
    if (result.ok) { setSelected(undefined); setEditing(false); router.refresh() }
  })
  const preview = selected === undefined ? null : { id: selected ?? 'draft', projectId, clientId, effectiveAt: draft.effectiveAt, effectiveUntil: draft.effectiveUntil || null, billable: draft.billable, includedBaseBps: 0, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 }
  const implied = preview && !preview.effectiveUntil && /^\d{4}-\d{2}-\d{2}$/.test(preview.effectiveAt) ? rangeEnd(preview, policies.filter(policy => policy.id !== selected).concat(preview)) : null
  return <dialog ref={dialog} aria-labelledby="rate-ranges-title" className="w-[min(42rem,calc(100%-2rem))] rounded-2xl border border-slate-200 p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40" onClose={onClose}>
    <form className="p-5" onSubmit={event => { event.preventDefault(); if (editing) save() }}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="rate-ranges-title" className="text-lg font-semibold">Rates for {name}</h2><p className="mt-1 text-sm text-slate-600">{projectId ? 'A project rate replaces the client default on the days it covers.' : 'A client rate covers linked projects only on days without their own project rate.'} A blank end runs until the day before the next rate.</p></div>
        <button type="button" className="text-sm text-slate-600 underline" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-4 rounded-xl border p-3 text-sm ${message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{message.message}</p>}
      {confirming && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950"><p>Delete the rate from {confirming.effectiveAt} to {rangeEnd(confirming, policies) ?? 'ongoing'}? Those dates follow the rate that remains. The daily Vercel amount follows that rate, or becomes £0.00 when no rate covers the day. Issued invoices stay unchanged.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50" disabled={pending} onClick={() => remove(confirming)}>{pending ? 'Deleting…' : 'Delete rate'}</button><button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirming(null)}>Cancel</button></div></div>}
      {selected === undefined ? <div className="mt-4">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr>{['From', 'To', 'Daily Vercel', ''].map(heading => <th key={heading} className="p-2">{heading}</th>)}</tr></thead><tbody>{ordered.map(policy => <tr key={policy.id} className="border-t"><td className="p-2">{policy.effectiveAt}</td><td className="p-2">{rangeEnd(policy, policies) ?? 'Ongoing'}</td><td className="p-2">£{pounds(policy.vercelDailyPence)}</td><td className="p-2 text-right"><div className="flex flex-col items-end gap-1"><button type="button" className="text-sm font-semibold text-blue-700 underline" onClick={() => openForm(policy, false)}>View</button><button type="button" className="text-sm font-semibold text-blue-700 underline" onClick={() => openForm(policy, true)}>Edit</button><button type="button" className="text-sm font-semibold text-red-700 underline" onClick={() => { setConfirming(policy); setMessage(null) }}>Delete</button></div></td></tr>)}</tbody></table></div>
        {!policies.length && <p className="text-sm text-slate-500">No rates yet.</p>}
        <button type="button" className={`${buttonClass} mt-4`} onClick={() => openForm(undefined, true)}>Add a rate</button>
      </div> : <>
        <fieldset disabled={pending || !editing} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">From (UTC)<input aria-label="Rate start date" className={inputClass} type="date" required value={draft.effectiveAt} onChange={event => setDraft({ ...draft, effectiveAt: event.target.value })} /></label>
          <label className="text-sm">To (UTC, optional)<input aria-label="Rate end date" className={inputClass} type="date" value={draft.effectiveUntil} onChange={event => setDraft({ ...draft, effectiveUntil: event.target.value })} /></label>
          <p className="sm:col-span-2 text-xs text-slate-500">{draft.effectiveUntil ? 'The end date is included.' : implied ? `Left blank, this rate runs through ${implied}.` : 'Left blank, this rate stays current until a later rate starts.'}</p>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.billable} onChange={event => setDraft({ ...draft, billable: event.target.checked })} />Chargeable to client</label>
          {([['includedBase', 'Included base (%)', '100'], ['markup', 'Cursor markup (percentage points)', '1000'], ['infrastructureMarkup', 'Infrastructure markup (%)', '1000']] as const).map(([key, label, max]) => <label key={key} className="text-sm">{label}<input aria-label={label} className={inputClass} type="number" min="0" max={max} step="0.01" required value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
          <label className="text-sm">Daily Vercel amount (£)<input aria-label="Daily Vercel amount" className={inputClass} inputMode="decimal" required value={draft.vercelDaily} onChange={event => setDraft({ ...draft, vercelDaily: event.target.value })} /></label>
          <p className="sm:col-span-2 text-xs text-slate-500">Saving replaces this {projectId ? 'project' : 'client'}’s Vercel Pro membership share for each day in the range, through today. Build CPU and other Vercel rows stay unchanged. Issued invoices stay unchanged.</p>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-3">{editing && <button className={buttonClass} disabled={pending}>{pending ? 'Saving…' : 'Save rate'}</button>}<button type="button" className="text-sm text-slate-600 underline" onClick={() => { setSelected(undefined); setEditing(false); setMessage(null) }}>Back to rates</button>{!editing && <button type="button" className={buttonClass} onClick={() => setEditing(true)}>Edit this rate</button>}{selected && <button type="button" className="text-sm font-semibold text-red-700 underline" onClick={() => { const policy = policies.find(item => item.id === selected); if (policy) { setConfirming(policy); setMessage(null) } }}>Delete this rate</button>}</div>
      </>}
    </form>
  </dialog>
}
