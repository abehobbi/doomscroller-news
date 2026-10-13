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

test('strict replacement shape excludes a region query from the wrong lane', () => {
  const queries = selectGapQueries({ audit: { laneGaps: { 'priority-interesting': 1, 'world-interesting': 1 }, regionGaps: { Syria: 1 } } }, 5, true)
  assert.ok(queries.some(item => item.id === 'syria-interesting'))
  assert.ok(!queries.some(item => item.id === 'syria-major'))
  assert.ok(queries.every(item => ['priority-interesting', 'world-interesting'].includes(item.lane)))
})

test('recovery prefers unused searches, covers every missing lane, and rotates priority regions', () => {
  const edition = { audit: { laneGaps: { 'world-major': 8, 'priority-major': 7, discovery: 1 }, regionGaps: { Syria: 1, Ghana: 1 } } }
  const previouslyRun = ['syria-major', 'bangladesh-major', 'ghana-major', 'gta-major', 'world-major-politics-security', 'world-major-interstate-escalation', 'world-major-civilian-harm', 'world-major-institutions-rights', 'world-major-economy-law', 'discovery-science-health', 'discovery-archaeology-history', 'discovery-nature-earth', 'discovery-space-technology']
  const queries = selectGapQueries(edition, 8, false, previouslyRun)
  assert.deepEqual(new Set(queries.map(item => item.lane)), new Set(['world-major', 'priority-major', 'priority-interesting', 'discovery']))
  assert.ok(queries.filter(item => item.lane === 'priority-major').every(item => !previouslyRun.includes(item.id)))
  assert.ok(new Set(queries.filter(item => item.lane === 'priority-major').map(item => item.region)).size >= 4)
})
