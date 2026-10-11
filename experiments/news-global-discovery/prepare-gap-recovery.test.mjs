import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareGapRecovery } from './prepare-gap-recovery.mjs'

test('gap recovery requests only the exact deficits and skips previously searched events', () => {
  const item = (eventId, lane, recommendation, score) => ({ eventId, lane, headline: eventId, editorialRecommendation: recommendation, editorialScore: score, baselineRank: 1, sourceAssessment: { decision: 'needs-source-review' } })
  const shortlist = {
    laneStatus: {
      'world-interesting': { minimum: 2, count: 1 },
      'world-major': { minimum: 3, count: 1 },
      discovery: { minimum: 1, count: 1 },
    },
    withheld: [
      item('wi', 'world-interesting', 'possible', 90),
      item('searched', 'world-major', 'strong', 99),
      item('baseline', 'world-major', 'baseline-qualified', null),
      item('possible', 'world-major', 'possible', 95),
      item('extra', 'world-major', 'possible', 90),
    ],
  }
  const result = prepareGapRecovery(shortlist, [{ results: [{ eventId: 'searched' }] }])
  assert.equal(result.requestedSearches, 3)
  assert.deepEqual(result.withheld.map(value => value.eventId), ['wi', 'baseline', 'possible'])
  assert.ok(result.withheld.every(value => value.gapRecoveryRequested))
})
