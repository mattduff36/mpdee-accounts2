import Link from 'next/link'
import { requireWrite } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ImportForm } from './ImportForm'
import { panel } from '../ui'
export default async function ImportPage() {
  await requireWrite()
  return <div className="space-y-6"><PageHeader title="Import project costs" description="Import sanitized account-wide events. Re-imports are safe and corrections keep a revision history."><Link href="/costs">Back to ledger</Link></PageHeader><ImportForm /><div className={`${panel} space-y-3 text-sm`}><p>Use the local collector to create an mpdee-costs-v1 file. Cursor cookies and access tokens stay on your computer. Existing iTrader daily summaries cannot identify projects or funding reliably and are not accepted as event history.</p><p>Infrastructure records need a stable invoice-line ID, billed amount, currency and resource reference. Import Supabase charges billed through Vercel once, as Vercel invoice lines. Do not also import those same charges from Supabase.</p><p>Unassigned events remain visible. Add an exact workspace, conversation or provider resource mapping under Projects & rates, then re-import the same file to apply that mapping.</p><p>Coverage defaults to unknown. Only complete, attributed events with an effective policy enter the client estimate. Configure the policy date to cover historical usage deliberately.</p></div></div>
}
