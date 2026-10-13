import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareOpportunityRecovery } from './prepare-opportunity-recovery.mjs'

const item = (eventId, selectionScore, reasons, lane = 'world-interesting') => ({ eventId, selectionScore, lane, readiness: { ready: !reasons.length, reasons } })

test('queues only the strongest unresolved opportunities for a blocker-specific second chance', () => {
  const verification = { repairQueue: [item('image', 130, ['no verified publisher image recovered']), item('weak', 80, ['no accessible evidence']), item('major', 95, ['high-risk event lacks two independent trusted source families'], 'world-major'), item('stale', 150, ['reporting period ended before window'])], rejected: [] }
  const firstRepair = { results: [item('image', 130, ['no verified publisher image recovered']), item('major', 95, [])] }
  const output = prepareOpportunityRecovery(verification, [firstRepair], 6)
  assert.deepEqual(output.repairQueue.map(value => value.eventId), ['image'])
})

test('bounds second-chance recovery by editorial score', () => {
  const verification = { repairQueue: [item('a', 140, ['no accessible evidence']), item('b', 130, ['no accessible evidence']), item('c', 120, ['no accessible evidence'])], rejected: [] }
  assert.deepEqual(prepareOpportunityRecovery(verification, [], 2).repairQueue.map(value => value.eventId), ['a', 'b'])
})
