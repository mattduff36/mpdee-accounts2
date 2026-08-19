"use client"

import { Children, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { LIST_PAGE_SIZE, withQuery, type MonthTab } from "@/lib/monthly-list"
import { cn } from "@/lib/utils"

export type SubtotalItem = {
  label: string
  value: string
  tone?: "default" | "success" | "danger" | "muted"
}

export function PagedDataTable({
  months,
  activeMonth,
  path,
  query,
  header,
  empty,
  colSpan,
  pageSize = LIST_PAGE_SIZE,
  subtotals,
  framed = true,
  children,
}: {
  months?: MonthTab[]
  activeMonth?: string
  path?: string
  query?: Record<string, string | undefined>
  header: ReactNode
  empty: string
  colSpan: number
  pageSize?: number
  subtotals?: { label: string; items: SubtotalItem[] }
  framed?: boolean
  children: ReactNode
}) {
  const rows = Children.toArray(children)
  const [limit, setLimit] = useState(pageSize)
  const resetKey = JSON.stringify({ month: activeMonth ?? "", query: query ?? {}, pageSize })

  useEffect(() => {
    setLimit(pageSize)
  }, [resetKey, pageSize])

  const shown = rows.slice(0, limit)
  const remaining = Math.max(0, rows.length - shown.length)
  const tones = {
    default: "text-slate-950",
    success: "text-emerald-700",
    danger: "text-rose-700",
    muted: "text-slate-600",
  }

  return (
    <div className={cn(framed && "rounded-lg border bg-white")}>
      {months && months.length > 0 && path && activeMonth && (
        <nav aria-label="Filter by month" className="border-b border-slate-100">
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {months.map((month) => {
              const selected = month.key === activeMonth
              return (
                <Link
                  key={month.key}
                  href={withQuery(path, query ?? {}, { month: month.key })}
                  scroll={false}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                    selected
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                      : "border border-slate-200 bg-white/90 text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <span>{month.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {month.count}
                  </span>
                  {month.preview && (
                    <span className={cn("text-xs tabular-nums", selected ? "text-blue-100" : "text-slate-500")}>
                      {month.preview}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
      <table className="w-full text-sm tabular-nums">
        <thead>{header}</thead>
        <tbody>
          {shown}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-slate-500">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 0 && subtotals && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-sm font-semibold text-slate-700">{subtotals.label}</p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {subtotals.items.map((item) => (
              <div key={item.label} className="flex items-baseline gap-2">
                <dt className="text-slate-500">{item.label}</dt>
                <dd className={cn("font-semibold tabular-nums", tones[item.tone ?? "default"])}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {remaining > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 text-center">
          <p className="mb-2 text-xs text-slate-500">
            Showing {shown.length} of {rows.length}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setLimit((current) => current + pageSize)}>
            Show {Math.min(pageSize, remaining)} more
          </Button>
        </div>
      )}
    </div>
  )
}
