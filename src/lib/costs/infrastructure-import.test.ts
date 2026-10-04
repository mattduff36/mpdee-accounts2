import assert from 'node:assert/strict'
import test from 'node:test'
import { planInfrastructureImports, type InfraRow } from './infrastructure-import'

const config = { projectIds: ['itrader', 'accounts'], resourceProjects: { db_1: ['itrader'], shared: ['itrader', 'accounts'] }, databaseResourceIds: ['db_1'] }
const row = (patch: Partial<InfraRow>): InfraRow => ({
  provider: 'vercel', accountRef: 'team', sourceId: 'focus-1', billedAmount: '1.50', currency: 'USD',
  periodStart: '2026-08-13T23:00:00.000Z', periodEnd: '2026-08-14T23:00:00.000Z', resourceRef: null, projectRef: 'itrader', serviceName: 'Functions', ...patch,
})

test('a Vercel-billed database is imported once and a second Supabase row is rejected', () => {
  const plan = planInfrastructureImports([
    row({ sourceId: 'focus-db', resourceRef: 'db_1', projectRef: null }),
    row({ provider: 'supabase', sourceId: 'supabase-db', resourceRef: 'db_1', projectRef: 'itrader' }),
  ], config)
  assert.equal(plan.accepted.length, 1)
  assert.equal(plan.accepted[0].provider, 'vercel')
  assert.equal(plan.accepted[0].category, 'DATABASE')
  assert.equal(plan.accepted[0].projectId, 'itrader')
  assert.match(plan.rejected[0].reason, /imported once through the Vercel source/)
})

test('membership rows are excluded, frozen client charges are rejected, and conflicts stay visible', () => {
  const plan = planInfrastructureImports([
    row({ sourceId: 'vercel:membership:2026-08-14', billedAmount: '0.38' }),
    row({ sourceId: 'frozen-1', frozenClientCharge: true }),
    row({ sourceId: 'shared-1', resourceRef: 'shared', projectRef: null }),
    row({ sourceId: 'focus-1' }),
    row({ sourceId: 'focus-1', billedAmount: '9' }),
  ], config)
  assert.equal(plan.excluded.length, 1)
  assert.match(plan.excluded[0].reason, /disabled/)
  assert.match(plan.rejected.map(item => item.reason).join(' '), /Frozen client charges/)
  assert.match(plan.rejected.map(item => item.reason).join(' '), /Duplicate/)
  assert.equal(plan.accepted.find(item => item.sourceKey === 'shared-1')?.attribution, 'conflict')
  assert.equal(plan.accepted.find(item => item.sourceKey === 'shared-1')?.projectId, null)
})
