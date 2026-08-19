import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth } from "@/lib/monthly-list"

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  })
  const groups = groupByMonth(logs, (log) => log.createdAt)
  const months = buildMonthTabs(groups, { includeKeys: [sp.month] })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" description="System activity log" />
      <PagedDataTable
        path="/settings/audit"
        months={months}
        activeMonth={activeMonth}
        empty={logs.length === 0 ? "No audit entries" : `No audit entries in ${monthLabel(activeMonth)}`}
        colSpan={5}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Entity</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Details</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "entry", "entries")}`,
          items: [{ label: "Events", value: String(visible.length), tone: "muted" }],
        }}
      >
        {visible.map((log) => (
          <tr key={log.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3">{formatDate(log.createdAt)}</td>
            <td className="px-4 py-3">{log.user?.name || log.user?.email || "System"}</td>
            <td className="px-4 py-3">
              <span className="text-xs font-medium">{log.action}</span>
            </td>
            <td className="px-4 py-3 text-gray-500">
              {log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)})` : ""}
            </td>
            <td className="px-4 py-3 text-gray-500">{log.details || "-"}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
