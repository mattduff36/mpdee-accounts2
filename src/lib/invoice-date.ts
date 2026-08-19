const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoDateOnly(value: string): Date {
  const match = ISO_DAY.exec(value.trim())
  if (!match) {
    throw new Error("Invalid date")
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error("Invalid date")
  }
  return utc
}

export function formatIsoDateOnly(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
