import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildMonthTabs,
  currentMonthKey,
  groupByMonth,
  monthKey,
  monthLabel,
  resolveActiveMonth,
  sumBy,
  withQuery,
} from "./monthly-list"

test("monthKey uses the local calendar month", () => {
  assert.equal(monthKey(new Date(2026, 7, 19)), "2026-08")
  assert.equal(monthKey(new Date(2026, 0, 1)), "2026-01")
  assert.equal(monthKey("not-a-date"), null)
})

test("monthLabel formats an en-GB month name", () => {
  assert.equal(monthLabel("2026-08"), "August 2026")
  assert.equal(monthLabel("2026-01"), "January 2026")
})

test("groupByMonth keeps items in encounter order", () => {
  const items = [
    { id: "a", date: new Date(2026, 7, 18) },
    { id: "b", date: new Date(2026, 6, 2) },
    { id: "c", date: new Date(2026, 7, 3) },
  ]
  const groups = groupByMonth(items, (item) => item.date)
  assert.deepEqual(
    groups.get("2026-08")?.map((item) => item.id),
    ["a", "c"],
  )
  assert.deepEqual(
    groups.get("2026-07")?.map((item) => item.id),
    ["b"],
  )
})

test("buildMonthTabs includes the current month and sorts newest first", () => {
  const now = new Date(2026, 7, 19)
  const groups = groupByMonth(
    [
      { total: 100, date: new Date(2026, 6, 1) },
      { total: 250, date: new Date(2026, 6, 12) },
    ],
    (item) => item.date,
  )
  const tabs = buildMonthTabs(groups, {
    now,
    preview: (items) => String(sumBy(items, (item) => item.total)),
  })
  assert.deepEqual(
    tabs.map((tab) => tab.key),
    ["2026-08", "2026-07"],
  )
  assert.equal(tabs[0]?.count, 0)
  assert.equal(tabs[0]?.preview, undefined)
  assert.equal(tabs[1]?.count, 2)
  assert.equal(tabs[1]?.preview, "350")
})

test("buildMonthTabs keeps a requested empty month so filters do not jump", () => {
  const now = new Date(2026, 7, 19)
  const groups = groupByMonth([{ date: new Date(2026, 7, 1) }], (item) => item.date)
  const tabs = buildMonthTabs(groups, { now, includeKeys: ["2026-06", "not-a-month"] })
  assert.deepEqual(
    tabs.map((tab) => tab.key),
    ["2026-08", "2026-06"],
  )
  assert.equal(resolveActiveMonth(tabs.map((tab) => tab.key), "2026-06", now), "2026-06")
})

test("resolveActiveMonth prefers a valid requested month, then the current month", () => {
  const now = new Date(2026, 7, 19)
  assert.equal(resolveActiveMonth(["2026-08", "2026-07"], "2026-07", now), "2026-07")
  assert.equal(resolveActiveMonth(["2026-08", "2026-07"], "2024-01", now), "2026-08")
  assert.equal(resolveActiveMonth(["2026-06", "2026-05"], undefined, now), "2026-06")
  assert.equal(currentMonthKey(now), "2026-08")
})

test("withQuery drops empty values and merges updates", () => {
  assert.equal(
    withQuery("/invoices", { status: "paid", search: "", month: "2026-07" }, { month: "2026-08" }),
    "/invoices?status=paid&month=2026-08",
  )
  assert.equal(withQuery("/expenses", {}), "/expenses")
})
