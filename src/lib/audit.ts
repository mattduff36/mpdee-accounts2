import { prisma } from './db'
export async function createAuditLog(data: { userId?: string; action: string; entityType: string; entityId?: string; details?: string; ipAddress?: string; userAgent?: string; invoiceId?: string }) {
  try { await prisma.auditLog.create({ data }) } catch {}
}
