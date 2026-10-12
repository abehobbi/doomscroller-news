import test from 'node:test'
import assert from 'node:assert/strict'
import { selectGapQueries } from './exa-dynamic-gap-recovery.mjs'

test('selects only queries that address measured lane or region gaps', () => {
  const queries = selectGapQueries({ audit: { laneGaps: { discovery: 2 }, regionGaps: { Ghana: 1 } } }, 3)
  assert.ok(queries.length <= 3)
  assert.ok(queries.some(item => item.lane === 'discovery'))
  assert.ok(queries.some(item => item.region === 'Ghana'))
  assert.ok(!queries.some(item => item.lane === 'world-major'))
  assert.equal(new Set(queries.map(item => item.id)).size, queries.length)
})

test('does not search when the verified edition has no gaps', () => {
  assert.deepEqual(selectGapQueries({ audit: { laneGaps: {}, regionGaps: {} } }), [])
})
