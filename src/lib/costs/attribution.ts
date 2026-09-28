export type AttributionEvent = { id: string; accountRef: string; provider: string; conversationId: string | null; workspaceRef: string | null; occurredAt: Date; projectId: string | null }
export function suggestProject(event: AttributionEvent, neighbours: AttributionEvent[]) {
  const scores = new Map<string, { projectId: string; score: number; evidence: string }>()
  for (const other of neighbours) {
    if (!other.projectId || other.accountRef !== event.accountRef || other.provider !== event.provider) continue
    const conversation = event.conversationId && other.conversationId === event.conversationId
    const workspace = event.workspaceRef && other.workspaceRef === event.workspaceRef
    const minutes = Math.abs(other.occurredAt.getTime() - event.occurredAt.getTime()) / 60000
    const score = conversation ? 95 : workspace ? 85 : minutes <= 30 ? 35 : 0
    if (!score) continue
    const evidence = conversation ? 'An assigned event uses the same conversation.' : workspace ? 'An assigned event uses the same workspace.' : 'Assigned activity occurred within 30 minutes; timing alone is weak evidence.'
    if ((scores.get(other.projectId)?.score ?? 0) < score) scores.set(other.projectId, { projectId: other.projectId, score, evidence })
  }
  const ranked = Array.from(scores.values()).sort((a,b) => b.score-a.score || a.projectId.localeCompare(b.projectId))
  if (!ranked.length) return { suggestion: null, candidates: ranked }
  // Competing projects with equally strong evidence are not a recommendation.
  return { suggestion: ranked[1]?.score === ranked[0].score ? null : ranked[0], candidates: ranked }
}
export function reviewGroupKey(event: AttributionEvent) {
  return [event.provider,event.accountRef,event.occurredAt.toISOString().slice(0,10),event.conversationId ?? event.id].join('|')
}
