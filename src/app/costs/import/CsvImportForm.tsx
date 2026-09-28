'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { buttonClass, inputClass, panel } from '../ui'

export function CsvImportForm() {
  const router = useRouter()
  const [accountEmail, setAccountEmail] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!file || !accountEmail) return
    setBusy(true); setMessage('Checking and saving CSV history…')
    try {
      if (file.size > 3_000_000) throw new Error('Choose a CSV smaller than 3 MB.')
      const response = await fetch('/api/costs/import-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountEmail, filename: file.name, csv: await file.text() }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'CSV import failed. No partial import was saved.')
      setMessage(`Saved ${result.added.toLocaleString()} new history records; ${result.duplicate.toLocaleString()} already saved. Financial totals are unchanged. Review the CSV history below.`)
      router.refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'CSV import failed.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className={`${panel} space-y-4`}>
    <div><h2 className="font-semibold text-slate-900">Recover Cursor CSV history</h2><p className="mt-2 text-sm text-slate-600">Upload an original Cursor usage export. CSV files omit project identifiers and precise costs, so these records are retained as evidence and excluded from financial totals.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Account used for this export<select className={inputClass} value={accountEmail} onChange={event => setAccountEmail(event.target.value)} required disabled={busy}><option value="">Choose the source account</option>{['admin@mpdee.co.uk','mattduff36@gmail.com','matt.mpdee@gmail.com','mattduff36@hotmail.com'].map(email => <option key={email}>{email}</option>)}</select></label>
      <label className="text-sm font-medium">Original usage CSV<input className={inputClass} type="file" accept=".csv,text/csv" disabled={busy} required onChange={event => { setFile(event.target.files?.[0] ?? null); setMessage('') }} /></label>
    </div>
    <p className="text-xs text-slate-500">The file does not identify its account. Check the selected email before saving. Re-importing the same rows is safe, including from an overlapping export.</p>
    <button className={buttonClass} disabled={busy || !file || !accountEmail}>{busy ? 'Saving history…' : 'Save CSV history'}</button>
    <p role="status" aria-live="polite" className="text-sm text-slate-700">{message}</p>
  </form>
}
