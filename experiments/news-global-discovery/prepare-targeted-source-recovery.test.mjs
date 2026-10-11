import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareTargetedRecovery } from './prepare-targeted-source-recovery.mjs'

test('targeted recovery selects exact requested stories and forces source replacement review', () => {
  const shortlist = {
    selected: [{ eventId: 'a', sourceAssessment: { decision: 'provisionally-usable' } }],
    withheld: [{ eventId: 'b', sourceAssessment: { decision: 'needs-source-review' } }],
  }
  const output = prepareTargetedRecovery(shortlist, ['b', 'a'])
  assert.deepEqual(output.withheld.map(value => value.eventId), ['b', 'a'])
  assert.ok(output.withheld.every(value => value.gapRecoveryRequested))
  assert.ok(output.withheld.every(value => value.sourceAssessment.decision === 'replace-source'))
})
