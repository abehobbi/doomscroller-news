import assert from 'node:assert/strict'
import test from 'node:test'

import { auditEdition, verifiedEventIds } from './assemble-verified-edition.mjs'

test('verified ids combine baseline readiness and successful repairs only', () => {
  const verification = { ready: [{ eventId: 'a' }] }
  const repair = { results: [{ eventId: 'b', readiness: { ready: true } }, { eventId: 'c', readiness: { ready: false } }] }
  assert.deepEqual([...verifiedEventIds(verification, repair)], ['a', 'b'])
})

test('edition audit reports exact lane and priority-region deficits', () => {
  const cards = [
    { lane: 'world-major', priorityRegions: [], acceptedSources: [{ domain: 'a.example' }] },
    { lane: 'priority-major', priorityRegions: ['Syria'], acceptedSources: [{ domain: 'b.example' }] },
  ]
  const audit = auditEdition(cards, {
    'world-major': { minimum: 2 }, 'priority-major': { minimum: 1 },
  }, { Syria: 2, Ghana: 1 })
  assert.deepEqual(audit.laneGaps, { 'world-major': 1 })
  assert.deepEqual(audit.regionGaps, { Syria: 1, Ghana: 1 })
})
