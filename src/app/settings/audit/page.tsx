import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true, email: true } } } })
  return <div className="space-y-4">
    <PageHeader title="Audit Log" description="System activity log" />
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Entity</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Details</th>
      </tr></thead><tbody>{logs.map(log => <tr key={log.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(log.createdAt)}</td>
        <td className="px-4 py-3">{log.user?.name || log.user?.email || "System"}</td>
        <td className="px-4 py-3"><span className="text-xs font-medium">{log.action}</span></td>
        <td className="px-4 py-3 text-gray-500">{log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)})` : ""}</td>
        <td className="px-4 py-3 text-gray-500">{log.details || "-"}</td>
      </tr>)}</tbody></table>
      {logs.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No audit entries</div>}
    </div>
  </div>
}
