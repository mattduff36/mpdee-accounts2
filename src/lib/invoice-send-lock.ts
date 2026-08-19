export function invoiceSendLockKey(invoiceId: string): string {
  return `invoice-send:${invoiceId}`
}
