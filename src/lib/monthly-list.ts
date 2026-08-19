export const LIST_PAGE_SIZE = 20

export function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value
}

export function isMonthKey(value?: string): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value)
}

export function monthKey(value: Date | string): string | null {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now) ?? "1970-01"
}

export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

export function groupByMonth<T>(items: T[], getDate: (item: T) => Date | string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = monthKey(getDate(item))
    if (!key) continue
    const existing = groups.get(key)
    if (existing) existing.push(item)
    else groups.set(key, [item])
  }
  return groups
}

export type MonthTab = {
  key: string
  label: string
  count: number
  preview?: string
}

export function buildMonthTabs<T>(
  groups: Map<string, T[]>,
  options?: {
    now?: Date
    includeCurrent?: boolean
    includeKeys?: Array<string | undefined>
    preview?: (items: T[]) => string | undefined
  },
): MonthTab[] {
  const keys = new Set(groups.keys())
  if (options?.includeCurrent ?? true) keys.add(currentMonthKey(options?.now))
  for (const key of options?.includeKeys ?? []) {
    if (isMonthKey(key)) keys.add(key)
  }
  return Array.from(keys)
    .sort()
    .reverse()
    .map((key) => {
      const items = groups.get(key) ?? []
      return {
        key,
        label: monthLabel(key),
        count: items.length,
        preview: items.length > 0 ? options?.preview?.(items) : undefined,
      }
    })
}

export function resolveActiveMonth(monthKeys: string[], requested?: string, now: Date = new Date()): string {
  if (isMonthKey(requested) && monthKeys.includes(requested)) return requested
  const current = currentMonthKey(now)
  if (monthKeys.includes(current)) return current
  return monthKeys[0] ?? current
}

export function withQuery(
  path: string,
  query: Record<string, string | undefined>,
  updates: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...query, ...updates })) {
    if (value == null || value === "") continue
    params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((sum, item) => sum + getValue(item), 0)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
