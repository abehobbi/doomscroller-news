import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRegionRecovery } from './prepare-region-recovery.mjs'

test('region recovery requests exact missing priority coverage without repeating searched events', () => {
  const item = (eventId, region, recommendation = 'strong', score = 90) => ({ eventId, lane: 'priority-interesting', headline: eventId, priorityRegions: [region], editorialRecommendation: recommendation, editorialScore: score, sourceAssessment: { decision: 'needs-source-review' } })
  const shortlist = {
    selected: [item('syria-ready', 'Syria'), item('ghana-ready', 'Ghana')],
    withheld: [item('syria-searched', 'Syria', 'strong', 99), item('syria-next', 'Syria', 'strong', 95), item('ghana-next', 'Ghana', 'strong', 92), item('ghana-extra', 'Ghana', 'possible', 80)],
  }
  const result = prepareRegionRecovery(shortlist, [{ results: [{ eventId: 'syria-searched' }] }], { Syria: 2, Ghana: 2 })
  assert.deepEqual(result.selectedCounts, { Syria: 1, Ghana: 1 })
  assert.deepEqual(result.gaps, { Syria: 1, Ghana: 1 })
  assert.deepEqual(result.withheld.map(value => value.eventId), ['syria-next', 'ghana-next'])
  assert.ok(result.withheld.every(value => value.gapRecoveryRequested))
})
