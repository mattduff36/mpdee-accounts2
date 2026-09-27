'use client'
import { useState } from 'react'
import { buttonClass, inputClass, panel } from '../ui'
export function ImportForm() {
  const [text,setText] = useState('')
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('Importing…')
    try {
      const response = await fetch('/api/costs/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Import failed')
      setMessage(`Saved ${result.received} records: ${result.added} new, ${result.revised} revised, ${result.duplicate} unchanged. ${result.unassigned} unassigned. Coverage: ${result.quality}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className={`${panel} space-y-4`}>
    <label className="block text-sm font-medium">Sanitized usage JSON<input className={inputClass} type="file" accept=".json,application/json" onChange={async e => { const file=e.target.files?.[0]; if (!file) return; if (file.size>3_000_000) {setMessage('Maximum file size is 3 MB. Split by day.'); return} setText(await file.text()); setMessage('File loaded. Review before importing.') }} /></label>
    <label className="block text-sm font-medium">Import contents<textarea className={`${inputClass} font-mono`} rows={14} value={text} onChange={e => setText(e.target.value)} required /></label>
    <button className={buttonClass} disabled={busy || !text}>{busy ? 'Importing…' : 'Import into ledger'}</button>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </form>
}
