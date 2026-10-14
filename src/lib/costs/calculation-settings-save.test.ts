import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ABSENT_CALCULATION_REVISION, resolveCalculationRates, type ProjectCalculationOverrides } from './calculation-settings'
import {
  saveGlobalCalculationSettings,
  saveProjectCalculationSettings,
  type CalculationSettingsSaveTx,
} from './calculation-settings-save'

const actor = { id: 'user_1' }
const t0 = new Date('2026-10-10T12:00:00.000Z')
const t1 = new Date('2026-10-10T13:00:00.000Z')

type GlobalRow = {
  id: string
  includedPremiumBps: number
  includedGrokComposerBps: number
  onDemandBps: number
  dailyHostingPence: number
  updatedAt: Date
}
type ProjectRow = {
  projectId: string
  includedPremiumBps: number | null
  includedGrokComposerBps: number | null
  onDemandBps: number | null
  dailyHostingPence: number | null
  hostingEnabled: boolean
  hostingStartDate: Date | null
  hostingEndDate: Date | null
  updatedAt: Date
}
type Audit = { userId: string; action: string; entityType: string; entityId: string; details: string }
type State = {
  global: GlobalRow | null
  projects: Map<string, ProjectRow>
  costProjects: Map<string, { id: string; archived: boolean }>
  audits: Audit[]
  calls: string[]
}

function cloneState(state: State): State {
  return {
    global: state.global ? { ...state.global, updatedAt: new Date(state.global.updatedAt) } : null,
    projects: new Map(Array.from(state.projects, ([id, row]) => [id, {
      ...row,
      hostingStartDate: row.hostingStartDate ? new Date(row.hostingStartDate) : null,
      hostingEndDate: row.hostingEndDate ? new Date(row.hostingEndDate) : null,
      updatedAt: new Date(row.updatedAt),
    }])),
    costProjects: new Map(state.costProjects),
    audits: state.audits.map(audit => ({ ...audit })),
    calls: [],
  }
}

function harness(seed: Partial<Pick<State, 'global' | 'projects' | 'costProjects'>> = {}, options?: { failAudit?: boolean; stickRevision?: boolean }) {
  const state: State = {
    global: seed.global ?? null,
    projects: seed.projects ?? new Map(),
    costProjects: seed.costProjects ?? new Map([['project-a', { id: 'project-a', archived: false }]]),
    audits: [],
    calls: [],
  }
  function tx(): CalculationSettingsSaveTx {
    return {
      costCalculationSettings: {
        findUnique: async () => { state.calls.push('global.read'); return state.global ? { ...state.global, updatedAt: new Date(state.global.updatedAt) } : null },
        create: async ({ data }) => {
          state.calls.push('global.create')
          const row: GlobalRow = { id: data.id ?? 'global', includedPremiumBps: data.includedPremiumBps, includedGrokComposerBps: data.includedGrokComposerBps, onDemandBps: data.onDemandBps, dailyHostingPence: data.dailyHostingPence, updatedAt: new Date(data.updatedAt) }
          state.global = row
          return { ...row, updatedAt: new Date(row.updatedAt) }
        },
        update: async ({ data }) => {
          state.calls.push('global.update')
          if (!state.global) throw new Error('missing global')
          const updatedAt = options?.stickRevision ? new Date(state.global.updatedAt) : new Date(data.updatedAt)
          state.global = { ...state.global, ...data, id: 'global', updatedAt }
          return { ...state.global, updatedAt: new Date(updatedAt) }
        },
      },
      costProjectCalculationSettings: {
        findUnique: async ({ where }) => { state.calls.push('project.read'); const row = state.projects.get(where.projectId); return row ? { ...row, updatedAt: new Date(row.updatedAt) } : null },
        create: async ({ data }) => {
          state.calls.push('project.create')
          const row: ProjectRow = { projectId: data.projectId, includedPremiumBps: data.includedPremiumBps, includedGrokComposerBps: data.includedGrokComposerBps, onDemandBps: data.onDemandBps, dailyHostingPence: data.dailyHostingPence, hostingEnabled: data.hostingEnabled, hostingStartDate: data.hostingStartDate, hostingEndDate: data.hostingEndDate, updatedAt: new Date(data.updatedAt) }
          state.projects.set(row.projectId, row)
          return { ...row, updatedAt: new Date(row.updatedAt) }
        },
        update: async ({ where, data }) => {
          state.calls.push('project.update')
          const existing = state.projects.get(where.projectId)
          if (!existing) throw new Error('missing project settings')
          const updatedAt = options?.stickRevision ? new Date(existing.updatedAt) : new Date(data.updatedAt)
          const row: ProjectRow = { ...existing, ...data, projectId: where.projectId, updatedAt }
          state.projects.set(where.projectId, row)
          return { ...row, updatedAt: new Date(updatedAt) }
        },
      },
      costProject: {
        findUnique: async ({ where }) => { state.calls.push('costProject.read'); return state.costProjects.get(where.id) ?? null },
      },
      auditLog: {
        create: async ({ data }) => {
          state.calls.push('audit')
          if (options?.failAudit) throw new Error('connection reset by peer password=secret')
          state.audits.push(data)
          return data
        },
      },
    }
  }
  return {
    state,
    async run<T>(fn: (tx: CalculationSettingsSaveTx) => Promise<T>): Promise<T> {
      const before = cloneState(state)
      try {
        return await fn(tx())
      } catch (error) {
        state.global = before.global
        state.projects = before.projects
        state.costProjects = before.costProjects
        state.audits = before.audits
        throw error
      }
    },
  }
}

function globalInput(revision: string, rates: Record<string, unknown> = { includedPremiumBps: '50', includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0' }) {
  return { expectedRevision: revision, ...rates }
}

function projectInput(patch: Record<string, unknown> = {}) {
  return {
    projectId: 'project-a',
    expectedRevision: ABSENT_CALCULATION_REVISION,
    expectedGlobalRevision: ABSENT_CALCULATION_REVISION,
    includedPremiumBps: null,
    includedGrokComposerBps: null,
    onDemandBps: null,
    dailyHostingPence: null,
    hostingEnabled: false,
    hostingStartDate: null,
    hostingEndDate: null,
    ...patch,
  }
}

test('global save stores string percentages and pounds, bumps a same-millisecond revision, and audits before and after', async () => {
  const db = harness()
  const created = await db.run(tx => saveGlobalCalculationSettings(globalInput(ABSENT_CALCULATION_REVISION, {
    includedPremiumBps: '0', includedGrokComposerBps: '2.5', onDemandBps: '1000', dailyHostingPence: '0.01',
  }), actor, tx, t0))
  assert.equal(created.ok, true)
  assert.equal(created.globalRevision, t0.toISOString())
  assert.deepEqual(created.rates, { includedPremiumBps: 0, includedGrokComposerBps: 250, onDemandBps: 100000, dailyHostingPence: 1 })
  assert.equal(db.state.audits.length, 1)
  assert.equal(db.state.audits[0].userId, 'user_1')
  const createdDetails = JSON.parse(db.state.audits[0].details)
  assert.equal(createdDetails.before, null)
  assert.equal(createdDetails.after.revision, t0.toISOString())
  assert.equal(createdDetails.after.rates.dailyHostingPence, 1)

  const bumped = await db.run(tx => saveGlobalCalculationSettings(globalInput(t0.toISOString(), {
    includedPremiumBps: '50', includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0',
  }), actor, tx, t0))
  assert.equal(bumped.ok, true)
  assert.equal(bumped.globalRevision, '2026-10-10T12:00:00.001Z')
  assert.equal(db.state.global?.updatedAt.toISOString(), '2026-10-10T12:00:00.001Z')
  assert.deepEqual(bumped.rates, { includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0 })
  const updatedDetails = JSON.parse(db.state.audits[1].details)
  assert.equal(updatedDetails.before.revision, t0.toISOString())
  assert.equal(updatedDetails.before.rates.includedPremiumBps, 0)
  assert.equal(updatedDetails.after.rates.includedPremiumBps, 5000)
  assert.deepEqual(db.state.calls.slice(-3), ['global.read', 'global.update', 'audit'])
})

test('invalid global input does not default empty values to zero or write', async () => {
  const db = harness()
  for (const raw of [
    globalInput(ABSENT_CALCULATION_REVISION, { includedPremiumBps: '', includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0' }),
    globalInput(ABSENT_CALCULATION_REVISION, { includedPremiumBps: 0, includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0' }),
    globalInput(ABSENT_CALCULATION_REVISION, { includedPremiumBps: '50', includedGrokComposerBps: '0', onDemandBps: '100' }),
    { ...globalInput(ABSENT_CALCULATION_REVISION), extra: '1' },
    globalInput('2026-10-10'),
  ]) {
    const result = await db.run(tx => saveGlobalCalculationSettings(raw, actor, tx, t0))
    assert.equal(result.ok, false)
    assert.equal(db.state.global, null)
    assert.equal(db.state.audits.length, 0)
  }
  assert.deepEqual(db.state.calls, [])
})

test('global stale and absent races do not write or retry', async () => {
  const db = harness({ global: { id: 'global', includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: t0 } })
  const absent = await db.run(tx => saveGlobalCalculationSettings(globalInput(ABSENT_CALCULATION_REVISION), actor, tx, t1))
  assert.equal(absent.ok, false)
  assert.match(absent.message, /Reload before saving/)
  assert.equal(db.state.global?.includedPremiumBps, 5000)
  const missing = harness()
  const gone = await missing.run(tx => saveGlobalCalculationSettings(globalInput(t0.toISOString()), actor, tx, t1))
  assert.equal(gone.ok, false)
  assert.equal(missing.state.global, null)
  assert.equal(missing.state.calls.filter(call => call === 'global.create').length, 0)
  assert.equal(db.state.calls.filter(call => call === 'global.update').length, 0)
})

test('a failed audit rolls the global write back', async () => {
  const db = harness({}, { failAudit: true })
  await assert.rejects(db.run(tx => saveGlobalCalculationSettings(globalInput(ABSENT_CALCULATION_REVISION), actor, tx, t0)), /password=secret/)
  assert.equal(db.state.global, null)
  assert.equal(db.state.audits.length, 0)
})

test('a revision that does not move forward aborts the global update', async () => {
  const db = harness({
    global: { id: 'global', includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: t0 },
  }, { stickRevision: true })
  await assert.rejects(db.run(tx => saveGlobalCalculationSettings(globalInput(t0.toISOString(), {
    includedPremiumBps: '12', includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '1',
  }), actor, tx, t1)), /did not advance/)
  assert.equal(db.state.global?.includedPremiumBps, 5000)
  assert.equal(db.state.global?.dailyHostingPence, 0)
  assert.equal(db.state.audits.length, 0)
})

test('project save keeps explicit zero distinct from inherit, and a global change does not freeze inherited fields', async () => {
  const db = harness()
  const saved = await db.run(tx => saveProjectCalculationSettings(projectInput({
    includedPremiumBps: null,
    includedGrokComposerBps: '0',
    onDemandBps: '10',
    dailyHostingPence: '0',
    hostingEnabled: false,
    hostingStartDate: '2026-01-01',
    hostingEndDate: '2026-01-31',
  }), actor, tx, t0))
  assert.equal(saved.ok, true)
  assert.equal(saved.projectRevision, t0.toISOString())
  const row = db.state.projects.get('project-a')
  assert.equal(row?.includedPremiumBps, null)
  assert.equal(row?.includedGrokComposerBps, 0)
  assert.equal(row?.onDemandBps, 1000)
  assert.equal(row?.dailyHostingPence, 0)
  assert.equal(row?.hostingEnabled, false)
  assert.equal(row?.hostingStartDate?.toISOString(), '2026-01-01T00:00:00.000Z')
  assert.equal(row?.hostingEndDate?.toISOString(), '2026-01-31T00:00:00.000Z')
  const audit = JSON.parse(db.state.audits[0].details)
  assert.equal(audit.before, null)
  assert.equal(audit.after.overrides.includedPremiumBps, null)
  assert.equal(audit.after.overrides.includedGrokComposerBps, 0)
  assert.equal(audit.globalRevision, ABSENT_CALCULATION_REVISION)

  const mark = db.state.calls.length
  const global = await db.run(tx => saveGlobalCalculationSettings(globalInput(ABSENT_CALCULATION_REVISION, {
    includedPremiumBps: '70', includedGrokComposerBps: '5', onDemandBps: '90', dailyHostingPence: '1.25',
  }), actor, tx, t1))
  assert.equal(global.ok, true)
  assert.equal(db.state.projects.get('project-a')?.includedPremiumBps, null)
  assert.equal(db.state.projects.get('project-a')?.includedGrokComposerBps, 0)
  assert.equal(db.state.calls.slice(mark).some(call => call.startsWith('project.')), false)
  const overrides: ProjectCalculationOverrides = {
    includedPremiumBps: null, includedGrokComposerBps: 0, onDemandBps: 1000, dailyHostingPence: 0,
    hostingEnabled: false, hostingStartDate: '2026-01-01', hostingEndDate: '2026-01-31',
  }
  assert.deepEqual(resolveCalculationRates(global.rates!, overrides), {
    includedPremiumBps: 7000, includedGrokComposerBps: 0, onDemandBps: 1000, dailyHostingPence: 0,
  })
})

test('project validation, missing and archived projects, and bad dates leave stored settings unchanged', async () => {
  const existing: ProjectRow = {
    projectId: 'project-a', includedPremiumBps: null, includedGrokComposerBps: 0, onDemandBps: null, dailyHostingPence: null,
    hostingEnabled: true, hostingStartDate: new Date('2026-03-01T00:00:00.000Z'), hostingEndDate: null, updatedAt: t0,
  }
  const db = harness({
    global: { id: 'global', includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: t0 },
    projects: new Map([['project-a', existing]]),
  })
  const badDates = await db.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(),
    expectedGlobalRevision: t0.toISOString(),
    hostingEnabled: true,
    hostingStartDate: '2026-04-02',
    hostingEndDate: '2026-04-01',
  }), actor, tx, t1))
  assert.match(badDates.message, /before start date/)
  assert.equal(db.state.projects.get('project-a')?.hostingStartDate?.toISOString(), '2026-03-01T00:00:00.000Z')
  assert.equal(db.state.audits.length, 0)

  const enabledWithoutStart = await db.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(), expectedGlobalRevision: t0.toISOString(), hostingEnabled: true,
  }), actor, tx, t1))
  assert.match(enabledWithoutStart.message, /requires a start date/)
  assert.equal(db.state.projects.get('project-a')?.hostingEnabled, true)

  const blank = await db.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(), expectedGlobalRevision: t0.toISOString(), dailyHostingPence: '',
  }), actor, tx, t1))
  assert.equal(blank.ok, false)
  assert.equal(db.state.projects.get('project-a')?.dailyHostingPence, null)

  const missing = harness()
  missing.state.costProjects.delete('project-a')
  const missingResult = await missing.run(tx => saveProjectCalculationSettings(projectInput(), actor, tx, t0))
  assert.equal(missingResult.message, 'Choose an active project.')
  assert.equal(missing.state.projects.size, 0)

  const archived = harness({ costProjects: new Map([['project-a', { id: 'project-a', archived: true }]]) })
  const archivedResult = await archived.run(tx => saveProjectCalculationSettings(projectInput(), actor, tx, t0))
  assert.equal(archivedResult.message, 'Choose an active project.')
  assert.equal(archived.state.projects.size, 0)
  assert.equal(db.state.calls.filter(call => call === 'project.update').length, 0)
})

test('stale global and stale or absent project revisions do not create or overwrite', async () => {
  const row: ProjectRow = {
    projectId: 'project-a', includedPremiumBps: 100, includedGrokComposerBps: null, onDemandBps: null, dailyHostingPence: null,
    hostingEnabled: false, hostingStartDate: null, hostingEndDate: null, updatedAt: t0,
  }
  const db = harness({
    global: { id: 'global', includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: t0 },
    projects: new Map([['project-a', row]]),
  })
  const staleGlobal = await db.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(), expectedGlobalRevision: ABSENT_CALCULATION_REVISION, includedPremiumBps: '1',
  }), actor, tx, t1))
  assert.match(staleGlobal.message, /Global calculation setup changed/)
  assert.equal(db.state.projects.get('project-a')?.includedPremiumBps, 100)

  const absentRace = await db.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: ABSENT_CALCULATION_REVISION, expectedGlobalRevision: t0.toISOString(), includedPremiumBps: '9',
  }), actor, tx, t1))
  assert.match(absentRace.message, /changed in another session/)
  assert.equal(db.state.projects.get('project-a')?.includedPremiumBps, 100)

  const gone = harness({
    global: { id: 'global', includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: t0 },
  })
  const deleted = await gone.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(), expectedGlobalRevision: t0.toISOString(),
  }), actor, tx, t1))
  assert.equal(deleted.ok, false)
  assert.equal(gone.state.projects.size, 0)
  assert.equal(gone.state.audits.length, 0)
  assert.equal(db.state.audits.length, 0)
})

test('project date failure after a previous save rolls back only the failed attempt', async () => {
  const db = harness({}, { failAudit: false })
  const saved = await db.run(tx => saveProjectCalculationSettings(projectInput({
    hostingEnabled: true, hostingStartDate: '2026-05-01', hostingEndDate: null, dailyHostingPence: '2',
  }), actor, tx, t0))
  assert.equal(saved.ok, true)
  const failing = harness({
    global: db.state.global,
    projects: db.state.projects,
    costProjects: db.state.costProjects,
  }, { failAudit: true })
  await assert.rejects(failing.run(tx => saveProjectCalculationSettings(projectInput({
    expectedRevision: t0.toISOString(),
    expectedGlobalRevision: ABSENT_CALCULATION_REVISION,
    hostingEnabled: true,
    hostingStartDate: '2026-06-01',
    dailyHostingPence: '4',
  }), actor, tx, t1)), /password=secret/)
  assert.equal(failing.state.projects.get('project-a')?.dailyHostingPence, 200)
  assert.equal(failing.state.projects.get('project-a')?.hostingStartDate?.toISOString(), '2026-05-01T00:00:00.000Z')
  assert.equal(failing.state.audits.length, 0)
})

test('settings actions and pages keep the write guard ahead of mutations and hide calculation setup from the readonly nav', () => {
  const actions = readFileSync(new URL('../../app/costs/settings/actions.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../../app/costs/settings/page.tsx', import.meta.url), 'utf8')
  const projects = readFileSync(new URL('../../app/costs/projects/page.tsx', import.meta.url), 'utf8')
  const nav = readFileSync(new URL('../../app/costs/CostsNav.tsx', import.meta.url), 'utf8')
  const save = readFileSync(new URL('./calculation-settings-save.ts', import.meta.url), 'utf8')
  for (const name of ['saveGlobalCalculationSettings', 'saveProjectCalculationSettings']) {
    const start = actions.indexOf(`export async function ${name}`)
    const body = actions.slice(start, actions.indexOf('export async function', start + 20) === -1 ? undefined : actions.indexOf('export async function', start + 20))
    const writeAt = body.indexOf('await requireWrite()')
    const authAt = body.indexOf('await requireAuth()')
    const tryAt = body.indexOf('try {')
    assert.ok(writeAt >= 0 && writeAt < authAt && authAt < tryAt && tryAt < body.indexOf('costTransaction('))
  }
  assert.match(actions, /NEXT_REDIRECT/)
  assert.doesNotMatch(actions, /error\.message/)
  assert.ok(page.indexOf('await requireWrite()') < page.indexOf('loadCalculationSettings('))
  assert.match(page, /Cost calculation setup/)
  assert.match(projects, /ProjectCalculationPanel/)
  assert.match(projects, /ProjectMatrix/)
  assert.match(nav, /Projects & connections/)
  assert.match(nav, /Calculation setup/)
  assert.match(nav, /const openToReaders=new Set\(\['\/costs','\/costs\/issues','\/costs\/period'\]\)/)
  assert.match(nav, /writable \|\| openToReaders\.has\(url\)/)
  assert.doesNotMatch(save, /@\/lib\/db|prisma/)
  assert.match(save, /export async function saveGlobalCalculationSettings/)
  assert.match(save, /export async function saveProjectCalculationSettings/)
})
