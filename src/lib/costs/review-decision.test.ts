import test from 'node:test'
import assert from 'node:assert/strict'
import { decideReviewGroup, relatesToTestsWorkspace } from './review-decision'

const names = new Map([['quiz', 'quiztaker-web'], ['itrader', 'iTrader'], ['accounts', 'MPDEE Accounts'], ['vision', 'MPDEE Vision']])
const timing = 'Assigned activity occurred within 30 minutes; timing alone is weak evidence.'

test('tests checkouts map to quiztaker even when timing suggests another project', () => {
  assert.equal(relatesToTestsWorkspace('D-Websites-tests-helper-restart'), true)
  assert.equal(relatesToTestsWorkspace('d-Websites-tests'), true)
  assert.equal(relatesToTestsWorkspace('d-Websites-testing'), false)
  assert.equal(relatesToTestsWorkspace('C-Users-mattd-Documents-Codex'), false)
  const decision = decideReviewGroup({
    workspace: 'd-Websites-tests',
    candidates: [{ projectId: 'itrader', score: 35, evidence: timing }],
    quiztakerProjectId: 'quiz',
    names,
  })
  assert.deepEqual(decision?.projectIds, ['quiz'])
  assert.match(decision?.reason ?? '', /Vitriol \(quiztaker-web\)/)
})

test('a unique score above 34% links that project and a tie splits equally', () => {
  const single = decideReviewGroup({
    workspace: null,
    candidates: [{ projectId: 'itrader', score: 35, evidence: timing }, { projectId: 'accounts', score: 34, evidence: timing }],
    quiztakerProjectId: 'quiz',
    names,
  })
  assert.deepEqual(single?.projectIds, ['itrader'])
  assert.match(single?.reason ?? '', /linked to iTrader/)
  const stronger = decideReviewGroup({
    workspace: null,
    candidates: [{ projectId: 'itrader', score: 95, evidence: 'An assigned event uses the same conversation.' }, { projectId: 'accounts', score: 35, evidence: timing }],
    quiztakerProjectId: 'quiz',
    names,
  })
  assert.deepEqual(stronger?.projectIds, ['itrader'])
  const tied = decideReviewGroup({
    workspace: null,
    candidates: [{ projectId: 'accounts', score: 35, evidence: timing }, { projectId: 'itrader', score: 35, evidence: timing }],
    quiztakerProjectId: 'quiz',
    names,
  })
  assert.deepEqual(tied?.projectIds, ['accounts', 'itrader'])
  assert.match(tied?.reason ?? '', /split equally/)
  assert.match(tied?.reason ?? '', /iTrader and MPDEE Accounts/)
  assert.equal(decideReviewGroup({ workspace: null, candidates: [], quiztakerProjectId: 'quiz', names }), null)
})
