export type CostReportRow = {
  date: string
  projectId: string | null
  projectName: string
  conversationId?: string | null
  taskTopics?: string[]
  provider: string
  funding: string | null
  nominal: bigint | null
  providerCash: bigint | null
  estimate: bigint | null
  held: boolean
}

type Daily = {
  date: string
  events: number
  held: number
  nominal: bigint
  nominalKnown: number
  providerCash: bigint
  providerCashKnown: number
  estimate: bigint
  estimateKnown: number
  included: bigint
  onDemand: bigint
  infrastructure: bigint
}

export function aggregateCostReport(rows: CostReportRow[]) {
  const daily = new Map<string, Daily>()
  const composition = new Map<string, bigint>()
  const chats = new Map<string, { date: string; projectId: string | null; projectName: string; conversationId: string; estimate: bigint; estimateKnown: number; cash: bigint; cashKnown: number; events: number; taskTopics: Set<string> }>()
  let nominal = BigInt(0), nominalKnown = 0
  let providerCash = BigInt(0), providerCashKnown = 0
  let estimate = BigInt(0), estimateKnown = 0, held = 0

  for (const row of rows) {
    let day = daily.get(row.date)
    if (!day) {
      day = { date: row.date, events: 0, held: 0, nominal: BigInt(0), nominalKnown: 0, providerCash: BigInt(0), providerCashKnown: 0, estimate: BigInt(0), estimateKnown: 0, included: BigInt(0), onDemand: BigInt(0), infrastructure: BigInt(0) }
      daily.set(row.date, day)
    }
    day.events++
    if (row.held) { day.held++; held++ }
    if (row.nominal !== null) { nominal += row.nominal; nominalKnown++; day.nominal += row.nominal; day.nominalKnown++ }
    if (row.providerCash !== null) { providerCash += row.providerCash; providerCashKnown++; day.providerCash += row.providerCash; day.providerCashKnown++ }
    if (row.estimate !== null) {
      estimate += row.estimate; estimateKnown++; day.estimate += row.estimate; day.estimateKnown++
      const category = row.provider !== 'cursor' ? 'Infrastructure' : row.funding === 'included' ? 'Included usage estimate' : 'On-demand estimate'
      composition.set(category, (composition.get(category) ?? BigInt(0)) + row.estimate)
      if (category === 'Infrastructure') day.infrastructure += row.estimate
      else if (row.funding === 'included') day.included += row.estimate
      else day.onDemand += row.estimate
    }
    if (row.conversationId) {
      const key = `${row.date}\u0000${row.projectId ?? ''}\u0000${row.conversationId}`
      let chat = chats.get(key)
      if (!chat) { chat = { date: row.date, projectId: row.projectId, projectName: row.projectName, conversationId: row.conversationId, estimate: BigInt(0), estimateKnown: 0, cash: BigInt(0), cashKnown: 0, events: 0, taskTopics: new Set() }; chats.set(key, chat) }
      chat.events++
      if (row.estimate !== null) { chat.estimate += row.estimate; chat.estimateKnown++ }
      if (row.providerCash !== null) { chat.cash += row.providerCash; chat.cashKnown++ }
      for (const topic of row.taskTopics ?? []) chat.taskTopics.add(topic)
    }
  }

  return {
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
    composition: Array.from(composition, ([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
    chats: Array.from(chats.values()).filter(chat => chat.estimateKnown > 0 && chat.estimate > BigInt(0)).sort((a, b) => a.date.localeCompare(b.date) || (a.estimate > b.estimate ? -1 : a.estimate < b.estimate ? 1 : a.conversationId.localeCompare(b.conversationId))).map(chat => ({ ...chat, cash: chat.cashKnown ? chat.cash : null, taskTopics: Array.from(chat.taskTopics) })),
    totals: { nominal, nominalKnown, providerCash, providerCashKnown, estimate, estimateKnown, held, events: rows.length },
  }
}
