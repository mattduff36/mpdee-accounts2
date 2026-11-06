/** Convert a user-facing currency amount without floating-point rounding. */
export function recurringAmountMinor(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return minor <= 2_000_000_000 ? minor : null
}
