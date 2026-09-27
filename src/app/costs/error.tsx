'use client'
export default function CostsError({ reset }: { reset: () => void }) {
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950"><h2 className="text-lg font-semibold">The cost ledger is unavailable</h2><p className="mt-2 text-sm">Check the preview database connection and apply the cost ledger migration. If the selected month exceeds 50,000 events, filter by project. No costs have been assumed or added to an invoice.</p><button onClick={reset} className="mt-4 rounded-lg bg-amber-900 px-4 py-2 text-sm text-white">Try again</button><a className="ml-4 text-sm underline" href="/costs">Reset filters</a></div>
}
