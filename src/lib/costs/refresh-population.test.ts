import assert from 'node:assert/strict'
import { test } from 'node:test'
import { populationText, summariseRefreshPopulation, workspaceRefForSlug, type RefreshSourceRow } from './refresh-population'

function rows(count: number, slug: string, storedLocally: boolean): RefreshSourceRow[] {
  return Array.from({ length: count }, () => ({ slug, accountValid: true, evidenceReadable: true, storedLocally }))
}

test('the 4 October source population reconciles without assigning unassigned work', () => {
  const population = summariseRefreshPopulation([
    ...rows(2201, 'other-projects', true),
    ...rows(1204, 'itrader', true),
    ...rows(1997, 'unassigned', true),
    ...rows(21, 'itrader', false),
    ...rows(12, 'unassigned', false),
  ])
  assert.equal(population.sourceRows, 5435)
  assert.equal(population.alreadyPresent, 5402)
  assert.equal(population.copied, 33)
  assert.equal(population.copiedBySlug.itrader, 21)
  assert.equal(population.copiedBySlug.unassigned, 12)
  assert.equal(population.unreadable + population.invalidAccount, 0)
  assert.equal(population.copied + population.alreadyPresent + population.unreadable + population.invalidAccount, 5435)
  assert.equal(workspaceRefForSlug('unassigned'), null)
  assert.equal(workspaceRefForSlug('itrader'), 'itrader-attributed')
  const text = populationText(population, { added: 0, duplicate: 33 })
  assert.match(text, /overlaps the copied rows/)
  assert.match(text, /sum to 5435/)
})

test('unreadable and invalid rows are separate from rows already stored', () => {
  const population = summariseRefreshPopulation([
    { slug: 'itrader', accountValid: true, evidenceReadable: false, storedLocally: false },
    { slug: 'itrader', accountValid: false, evidenceReadable: true, storedLocally: false },
    { slug: 'itrader', accountValid: true, evidenceReadable: true, storedLocally: true },
  ])
  assert.equal(population.sourceRows, 3)
  assert.equal(population.unreadable, 1)
  assert.equal(population.invalidAccount, 1)
  assert.equal(population.alreadyPresent, 1)
  assert.equal(population.copied, 0)
})
