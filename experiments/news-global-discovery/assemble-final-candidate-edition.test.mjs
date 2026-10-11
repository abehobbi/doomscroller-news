import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleFinalCandidates } from './assemble-final-candidate-edition.mjs'

const event = (id, lane, headline, selectionScore = 100) => ({
  id, selectionScore, independentSourceCount: 2,
  representative: { selection: { assignedLane: lane }, snapshot: { title: headline, evidenceText: `${headline}. Officials supplied specific evidence about the development.` } },
})
const score = (eventId, recommendation, editorialScore) => ({ eventId, editorialScore, evaluation: { recommendation, reason: 'Grounded editorial judgment.' } })

test('major stories pass only after pool qualification while weak interesting stories are withheld', () => {
  const pool = { events: [event('major', 'world-major', 'Strike kills 25 people in city'), event('strong', 'world-interesting', 'A distinctive village story'), event('weak', 'world-interesting', 'Routine local promotion')] }
  const scores = { complete: true, results: [score('strong', 'strong', 84), score('weak', 'possible', 60)] }
  const result = assembleFinalCandidates(pool, scores)
  assert.deepEqual(result.selected.map(value => value.eventId), ['major', 'strong'])
  assert.deepEqual(result.withheld.map(value => value.eventId), ['weak'])
})

test('same institution and action are consolidated after scoring', () => {
  const pool = { events: [event('one', 'world-major', 'US unveils sanctions on ICC'), event('two', 'world-major', 'US sanctions on ICC put justice at risk', 90)] }
  const result = assembleFinalCandidates(pool, { complete: true, results: [] })
  assert.equal(result.selectedCount, 1)
  assert.equal(result.duplicateCount, 1)
})
