export type AttributionEvent = { id: string; accountRef: string; provider: string; conversationId: string | null; workspaceRef: string | null; occurredAt: Date; projectId: string | null }
const CONVERSATION_EVIDENCE = 'An assigned event uses the same conversation.'
const WORKSPACE_EVIDENCE = 'An assigned event uses the same workspace.'
const TIMING_EVIDENCE = 'Assigned activity occurred within 30 minutes; timing alone is weak evidence.'
const TIMING_WINDOW_MS = 30 * 60 * 1000
export function suggestProject(event: AttributionEvent, neighbours: AttributionEvent[]) {
  const scores = new Map<string, { projectId: string; score: number; evidence: string }>()
  for (const other of neighbours) {
    if (!other.projectId || other.accountRef !== event.accountRef || other.provider !== event.provider) continue
    const conversation = event.conversationId && other.conversationId === event.conversationId
    const workspace = event.workspaceRef && other.workspaceRef === event.workspaceRef
    const minutes = Math.abs(other.occurredAt.getTime() - event.occurredAt.getTime()) / 60000
    const score = conversation ? 95 : workspace ? 85 : minutes <= 30 ? 35 : 0
    if (!score) continue
    const evidence = conversation ? CONVERSATION_EVIDENCE : workspace ? WORKSPACE_EVIDENCE : TIMING_EVIDENCE
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

type TimedProject = { at: number; projectId: string }
export type AssignmentIndex = Map<string, { times: TimedProject[]; conversation: Map<string, string[]>; workspace: Map<string, string[]> }>

function bucketKey(event: Pick<AttributionEvent, 'provider' | 'accountRef'>) {
  return `${event.provider}\0${event.accountRef}`
}

function remember(map: Map<string, string[]>, key: string, projectId: string) {
  const projects = map.get(key)
  if (!projects) map.set(key, [projectId])
  else if (!projects.includes(projectId)) projects.push(projectId)
}

/** Same scores as suggestProject, without scanning every neighbour for every event. */
export function buildAssignmentIndex(events: AttributionEvent[]): AssignmentIndex {
  const index: AssignmentIndex = new Map()
  for (const event of events) {
    if (!event.projectId) continue
    const key = bucketKey(event)
    let bucket = index.get(key)
    if (!bucket) {
      bucket = { times: [], conversation: new Map(), workspace: new Map() }
      index.set(key, bucket)
    }
    bucket.times.push({ at: event.occurredAt.getTime(), projectId: event.projectId })
    if (event.conversationId) remember(bucket.conversation, event.conversationId, event.projectId)
    if (event.workspaceRef) remember(bucket.workspace, event.workspaceRef, event.projectId)
  }
  for (const bucket of index.values()) bucket.times.sort((a, b) => a.at - b.at)
  return index
}

function lowerBound(times: TimedProject[], target: number) {
  let lo = 0, hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid].at < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function consider(scores: Map<string, { projectId: string; score: number; evidence: string }>, projectId: string, score: number, evidence: string) {
  if ((scores.get(projectId)?.score ?? 0) < score) scores.set(projectId, { projectId, score, evidence })
}

export function suggestFromIndex(event: AttributionEvent, index: AssignmentIndex) {
  const bucket = index.get(bucketKey(event))
  if (!bucket) return { suggestion: null as { projectId: string; score: number; evidence: string } | null, candidates: [] as { projectId: string; score: number; evidence: string }[] }
  const scores = new Map<string, { projectId: string; score: number; evidence: string }>()
  if (event.conversationId) for (const projectId of bucket.conversation.get(event.conversationId) ?? []) consider(scores, projectId, 95, CONVERSATION_EVIDENCE)
  if (event.workspaceRef) for (const projectId of bucket.workspace.get(event.workspaceRef) ?? []) consider(scores, projectId, 85, WORKSPACE_EVIDENCE)
  const at = event.occurredAt.getTime()
  const times = bucket.times
  for (let i = lowerBound(times, at - TIMING_WINDOW_MS); i < times.length && times[i].at <= at + TIMING_WINDOW_MS; i++) consider(scores, times[i].projectId, 35, TIMING_EVIDENCE)
  const ranked = Array.from(scores.values()).sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId))
  if (!ranked.length) return { suggestion: null, candidates: ranked }
  return { suggestion: ranked[1]?.score === ranked[0].score ? null : ranked[0], candidates: ranked }
}
