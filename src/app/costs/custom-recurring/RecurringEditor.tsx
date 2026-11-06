'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomRecurringDto } from '@/lib/costs/custom-recurring-store'
import { recurringAmountMinor } from '@/lib/costs/recurring-amount'

type Props = {
  projects: { id: string; name: string; archived: boolean }[]
  record?: CustomRecurringDto & { notes: string | null }
}
const input = 'mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900'

export function RecurringEditor({ projects, record }: Props) {
  const router = useRouter()
  const sourceKey = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflicted, setConflicted] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const amountMinor = recurringAmountMinor(String(data.get('amount')))
    if (amountMinor === null) { setMessage('Enter a monthly amount with up to two decimal places, such as 9.00.'); return }
    if (!sourceKey.current) sourceKey.current = `accounts:${crypto.randomUUID()}`
    const fields = {
      projectId: data.get('projectId'), provider: data.get('provider'), name: data.get('name'),
      currency: data.get('currency'), amountMinor, recurrence: 'monthly',
      effectiveStart: data.get('effectiveStart'), effectiveEnd: data.get('effectiveEnd') || null,
      active: data.get('active') === 'on', notes: data.get('notes') || null,
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/costs/custom-recurring', {
        method: record ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'mpdee-custom-recurring-v1',
          ...(record ? { id: record.id, expectedRevision: record.revision } : { sourceKey: sourceKey.current }),
          ...fields,
        }),
      })
      const result: { error?: string; status?: string } = await response.json()
      if (!response.ok) {
        setMessage(result.error ?? 'Nothing saved. Try again.')
        if (response.status === 409) setConflicted(true)
        return
      }
      setMessage(result.status === 'duplicate' ? 'Already saved; existing Accounts values retained.' : 'Saved recurring commitment. No payment or charge recorded.')
      if (!record) { form.reset(); sourceKey.current = null }
      router.refresh()
    } catch {
      setMessage('Save could not be confirmed. Retry the unchanged form to safely check the same source key.')
    } finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={busy || conflicted} className="grid gap-4 text-sm sm:grid-cols-2">
      <label>Project<select name="projectId" required defaultValue={record?.projectId ?? ''} className={input}>
        <option value="" disabled>Choose a project</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? ' (archived)' : ''}</option>)}
      </select></label>
      <label>Provider<input name="provider" required maxLength={120} defaultValue={record?.provider} className={input} /></label>
      <label>Name<input name="name" required maxLength={120} defaultValue={record?.name} className={input} /></label>
      <label>Currency<select name="currency" defaultValue={record?.currency ?? 'USD'} className={input}>
        {['GBP', 'USD', 'EUR'].map(currency => <option key={currency}>{currency}</option>)}
      </select></label>
      <label>Monthly amount<input name="amount" type="number" min="0" max="20000000" step="0.01" required placeholder="9.00" defaultValue={record ? (record.amountMinor / 100).toFixed(2) : undefined} className={input} /></label>
      <label>Effective start<input name="effectiveStart" type="date" min="1900-01-01" max="9999-12-31" required defaultValue={record?.effectiveStart} className={input} /></label>
      <label>Effective end (exclusive, optional)<input name="effectiveEnd" type="date" min="1900-01-01" max="9999-12-31" defaultValue={record?.effectiveEnd ?? ''} className={input} /></label>
      <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={record?.active ?? true} />Enabled</label>
      <label className="sm:col-span-2">Private notes (not in read API)<textarea name="notes" maxLength={2000} defaultValue={record?.notes ?? ''} className={input} /></label>
      <button type="submit" disabled={!projects.length} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : record ? 'Save changes' : 'Add commitment'}</button>
    </fieldset>
    {!projects.length && <p className="text-sm text-amber-800">Create a cost project in Projects &amp; connections before adding a commitment.</p>}
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    {conflicted && <button type="button" onClick={() => window.location.reload()} className="text-sm text-blue-700 underline">Reload current values before editing</button>}
  </form>
}
