import assert from 'node:assert/strict'
import test from 'node:test'

import { assembleVerifiedCards, auditEdition, imageExceptionIds, verifiedEventIds } from './assemble-verified-edition.mjs'

test('verified ids combine baseline readiness and successful repairs only', () => {
  const verification = { ready: [{ eventId: 'a' }] }
  const repair = { results: [{ eventId: 'b', readiness: { ready: true } }, { eventId: 'c', readiness: { ready: false } }] }
  assert.deepEqual([...verifiedEventIds(verification, repair)], ['a', 'b'])
})

test('verified ids combine multiple repair passes', () => {
  const verification = { ready: [{ eventId: 'a' }] }
  const repairs = [
    { results: [{ eventId: 'b', readiness: { ready: true } }] },
    { results: [{ eventId: 'c', readiness: { ready: true } }, { eventId: 'd', readiness: { ready: false } }] },
  ]
  assert.deepEqual([...verifiedEventIds(verification, repairs)], ['a', 'b', 'c'])
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

test('image exceptions are rare, score-bounded, and require otherwise ready trusted evidence', () => {
  const item = (eventId, selectionScore, reasons = ['no verified publisher image recovered']) => ({
    eventId, selectionScore,
    readiness: { ready: false, reasons, trustedSourceFamilies: 1, acceptedSourceCount: 1 },
  })
  const verification = { ready: [], repairQueue: [item('strongest', 140), item('second', 130), item('third', 120), item('weak', 114), item('mixed', 150, ['no verified publisher image recovered', 'no trusted or registered publisher source'])], rejected: [] }
  const exceptions = imageExceptionIds(verification, { results: [] })
  assert.deepEqual([...exceptions], ['strongest', 'second'])
  assert.deepEqual([...verifiedEventIds(verification, { results: [] }, exceptions)], ['strongest', 'second'])
})

test('an approved image-only exception reaches the writer without a fabricated image', () => {
  const title = 'Coastal community secures landmark drinking-water protections'
  const source = { accepted: true, trusted: true, domain: 'bbc.com', url: 'https://bbc.com/story', title, publishedAt: '2026-10-13T10:00:00Z', evidenceText: 'The coastal community secured landmark drinking-water protections after a long public campaign.', sharedTerms: ['coastal', 'community', 'landmark', 'protections'], imageUrl: null }
  const readiness = { ready: false, reasons: ['no verified publisher image recovered'], trustedSourceFamilies: 1, acceptedSourceCount: 1, image: null }
  const selection = { id: 'story', assignedLane: 'world-interesting', adjustedScore: 130, representative: { title, publishedAt: '2026-10-13T10:00:00Z', priorityRegions: [], url: source.url }, members: [{ title, priorityRegions: [] }] }
  const verification = { ready: [], repairQueue: [{ eventId: 'story', selectionScore: 130, readiness, sources: [source] }], rejected: [] }
  const cards = assembleVerifiedCards({ selections: [selection] }, verification, { results: [] })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].image, null)
  assert.equal(cards[0].imageException.granted, true)
})
