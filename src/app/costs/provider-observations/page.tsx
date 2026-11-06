import { PageHeader } from '@/components/PageHeader'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { providerObservationQuerySchema } from '@/lib/costs/provider-observations'
import { listProviderObservations } from '@/lib/costs/provider-observations-store'
import { panel } from '../ui'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ProviderObservationsPage({ searchParams }: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  await requireAuth()
  const query = providerObservationQuerySchema.safeParse({
    ...searchParams,
    accountRef: searchParams.accountRef === '' ? undefined : searchParams.accountRef,
    sourceKey: searchParams.sourceKey === '' ? undefined : searchParams.sourceKey,
  })
  if (!query.success) return <div className={panel}>Invalid observation filters. Use accountRef, sourceKey, provider=vercel and a limit from 1 to 100.</div>
  const report = await listProviderObservations(query.data)
  const projectIds = [...new Set(report.records.flatMap(row => row.groups.flatMap(group => group.projectId ? [group.projectId] : [])))]
  const projects = projectIds.length ? await prisma.costProject.findMany({
    where: { id: { in: projectIds } }, select: { id: true, name: true },
  }) : []
  const projectNames = new Map(projects.map(project => [project.id, project.name]))
  return <div className="space-y-6 pb-10">
    <PageHeader title="Provider observations" description="Read-only provisional Vercel exports. Latest observation per provider, account and source key." />
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
      These snapshots may overlap: never add them together. Usage and subscription values are shown separately in their native currencies, with no grand total or currency conversion. They are not cash paid, invoices, expenses or client charges and do not enter legacy financial reports. Period end dates are exclusive. Latest means observed date, then received date.
    </div>
    <form method="get" className={`${panel} flex flex-wrap items-end gap-3`}>
      <label className="text-sm">Account reference<input name="accountRef" defaultValue={query.data.accountRef} maxLength={160} className="mt-1 block rounded border p-2" /></label>
      <label className="text-sm">Source key<input name="sourceKey" defaultValue={query.data.sourceKey} maxLength={160} className="mt-1 block rounded border p-2" /></label>
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">Filter observations</button>
    </form>
    {report.truncated && <p role="status" className={panel}>Results limited to {report.limit} source identities. Refine the account reference or source key to see omitted observations. Overlap warnings apply beyond this limited view too.</p>}
    {!report.records.length && <p className={panel}>No provider observations found. No usage, subscription or payment value is assumed.</p>}
    {report.records.map(row => <article key={row.id} className={`${panel} space-y-4`}>
      <div><h2 className="break-words text-lg font-semibold">Vercel / {row.accountRef}</h2>
        <p className="break-words text-sm text-slate-600">Source: {row.sourceKey}</p></div>
      <p className="text-sm">Coverage: {row.coverage}. Source status: {row.status.replaceAll('_', ' ')}. Observed: {row.observedAt}. Received: {row.createdAt}.</p>
      <div className="text-sm"><h3 className="font-semibold">Native periods (end exclusive)</h3>
        <ul>{row.periods.map((period, index) => <li key={index}>{period.from} to {period.to}</li>)}</ul></div>
      <div className="text-sm"><h3 className="font-semibold">Declared gaps</h3>
        {row.gaps.length ? <ul>{row.gaps.map((gap, index) => <li key={index}>{gap.from} to {gap.to}</li>)}</ul> : <p>No gaps declared; this is not independent verification of completeness.</p>}</div>
      {!!row.warnings.length && <p className="text-sm text-amber-900">Warnings: {row.warnings.map(warning => warning.replaceAll('_', ' ')).join('; ')}.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Separate provider values for this observation only</caption>
        <thead><tr><th className="p-2">Accounts project</th><th className="p-2">Resource</th><th className="p-2">Currency</th><th className="p-2">Usage value</th><th className="p-2">Subscription value</th></tr></thead>
        <tbody>{row.groups.map((group, index) => <tr key={index} className="border-t">
          <td className="break-words p-2">{group.projectId ? projectNames.get(group.projectId) ?? `Unavailable project (${group.projectId})` : 'Unassigned'}</td>
          <td className="break-words p-2">{group.resourceId ?? 'Not specified'}</td><td className="p-2">{group.currency}</td>
          <td className="p-2">{group.usageValue}</td><td className="p-2">{group.subscriptionValue}</td>
        </tr>)}</tbody>
      </table></div>
      {!row.groups.length && <p className="text-sm">No resource groups supplied; no zero-value assertion is made.</p>}
      {row.notes && <p className="whitespace-pre-wrap break-words text-sm">{row.notes}</p>}
      <details className="text-xs text-slate-500"><summary>Source integrity</summary>
        <p className="break-all">Export SHA-256: {row.sourceHash}</p><p className="break-all">Observation checksum: {row.checksum}</p></details>
    </article>)}
  </div>
}
