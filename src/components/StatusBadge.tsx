import { Badge } from "./ui/badge"
const statusMap: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  sent: { label: 'Sent', variant: 'info' },
  viewed: { label: 'Viewed', variant: 'info' },
  partial: { label: 'Partial', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  overdue: { label: 'Overdue', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
  written_off: { label: 'Written Off', variant: 'neutral' },
  open: { label: 'Open', variant: 'default' },
  applied: { label: 'Applied', variant: 'success' },
  refunded: { label: 'Refunded', variant: 'success' },
  accepted: { label: 'Accepted', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  converted: { label: 'Converted', variant: 'success' },
  expired: { label: 'Expired', variant: 'neutral' },
}
export function StatusBadge({ status }: { status: string }) {
  const config = statusMap[status] || { label: status, variant: 'neutral' }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
