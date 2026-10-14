export type ReviewCandidate = { projectId: string; score: number; evidence: string }

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** D-Websites-tests and its checkouts, including a different drive-letter case. */
export function relatesToTestsWorkspace(workspace: string | null): boolean {
  return !!workspace && /^d-websites-tests(?:-|$)/i.test(workspace)
}

/**
 * Rules for the usage currently shown on /costs/review.
 * A tests workspace wins. Otherwise a unique score above 34% selects that project.
 * A tie above 34% is shared equally. Anything else stays unassigned.
 */
export function decideReviewGroup(input: {
  workspace: string | null
  candidates: ReviewCandidate[]
  quiztakerProjectId: string
  names: ReadonlyMap<string, string>
}): { projectIds: string[]; reason: string } | null {
  const label = (id: string) => input.names.get(id) ?? id
  if (relatesToTestsWorkspace(input.workspace)) {
    const reason = `Workspace "${input.workspace}" relates to D-Websites-tests, which is Vitriol (${label(input.quiztakerProjectId)}). Assigned from that workspace name.`
    if (reason.length > 500) throw new Error('Review reason is too long')
    return { projectIds: [input.quiztakerProjectId], reason }
  }
  const above = input.candidates.filter(candidate => candidate.score > 34)
  if (!above.length) return null
  const top = Math.max(...above.map(candidate => candidate.score))
  const chosen = above.filter(candidate => candidate.score === top).sort((a, b) => a.projectId.localeCompare(b.projectId))
  if (chosen.length === 1) {
    const one = chosen[0]
    const reason = `Evidence score ${one.score}%. ${one.evidence} The score is above 34%, so this usage is linked to ${label(one.projectId)}.`
    if (reason.length > 500) throw new Error('Review reason is too long')
    return { projectIds: [one.projectId], reason }
  }
  const names = listNames(chosen.map(candidate => label(candidate.projectId)).sort((a, b) => a.localeCompare(b)))
  const reason = `Evidence score ${top}% is tied across ${names}. ${chosen[0].evidence} Each of those scores is above 34% and there is no single recommended project, so the cost is split equally.`
  if (reason.length > 500) throw new Error('Review reason is too long')
  return { projectIds: chosen.map(candidate => candidate.projectId), reason }
}
