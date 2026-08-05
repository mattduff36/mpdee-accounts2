export function formatCurrency(pence: number | null | undefined): string {
  if (pence == null) return '£0.00'
  const pounds = Math.abs(pence) / 100
  const sign = pence < 0 ? '-' : ''
  return `${sign}£${pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function formatCurrencyShort(pence: number | null | undefined): string {
  if (pence == null) return '£0'
  const pounds = Math.abs(pence) / 100
  const sign = pence < 0 ? '-' : ''
  if (pounds >= 1000000) return `${sign}£${(pounds / 1000000).toFixed(1)}M`
  if (pounds >= 1000) return `${sign}£${(pounds / 1000).toFixed(1)}k`
  return `${sign}£${pounds.toFixed(2)}`
}
export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '')
  const pounds = parseFloat(cleaned)
  return isNaN(pounds) ? 0 : Math.round(pounds * 100)
}
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function formatDateISO(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().split('T')[0]
}
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}
export function startOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1) }
export function endOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999) }
export function startOfYear(date: Date): Date { return new Date(date.getFullYear(), 0, 1) }
export function endOfYear(date: Date): Date { return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999) }
export function isOverdue(dueDate: Date | string): boolean { return new Date(dueDate) < new Date() }
export function daysOverdue(dueDate: Date | string): number { return Math.max(0, Math.floor((new Date().getTime() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24))) }
export function daysUntilDue(dueDate: Date | string): number { return Math.max(0, Math.ceil((new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) }
export function calculateLineTotal(quantity: number, unitPrice: number, vatRate: number, discount: number = 0): { lineTotal: number; vatAmount: number } {
  const net = Math.max(0, Math.round(quantity * unitPrice) - discount)
  const vat = vatRate > 0 ? Math.round(net * (vatRate / 100)) : 0
  return { lineTotal: net, vatAmount: vat }
}
export function generateInvoiceNumber(prefix: string, number: number): string { return `${prefix}-${String(number).padStart(4, '0')}` }
export function generateQuoteNumber(prefix: string, number: number): string { return `${prefix}-Q${String(number).padStart(4, '0')}` }
