import assert from 'node:assert/strict'
import test from 'node:test'

import { selectGapCandidates } from './prepare-lane-gap-repair.mjs'

test('gap repair selects exact lane deficits and prefers candidates not previously searched', () => {
  const item = (eventId, lane, selectionScore) => ({ eventId, lane, selectionScore })
  const verification = { repairQueue: [item('done', 'world-major', 110), item('old', 'world-major', 100), item('fresh', 'world-major', 90), item('science', 'discovery', 80)] }
  const selected = selectGapCandidates(verification, { results: [{ eventId: 'done', readiness: { ready: true } }, { eventId: 'old', readiness: { ready: false } }] }, { 'world-major': 1, discovery: 1 })
  assert.deepEqual(selected.map(value => value.eventId), ['fresh', 'science'])
})
