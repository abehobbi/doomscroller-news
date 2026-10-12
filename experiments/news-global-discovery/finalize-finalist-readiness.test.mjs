import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeReadiness } from './finalize-finalist-readiness.mjs'

test('only source-ready finalists with a live image enter generation', () => {
  const candidate = eventId => ({ eventId, blockers: [], sourceReadiness: { ready: true } })
  const report = finalizeReadiness({ candidateCount: 3, ready: [candidate('a'), candidate('b')], repair: [candidate('c')] }, { results: [{ eventId: 'a', valid: true }, { eventId: 'b', valid: false, reason: 'not an image' }] })
  assert.deepEqual(report.generationReady.map(value => value.eventId), ['a'])
  assert.deepEqual(report.imageRepair.map(value => value.eventId), ['b'])
  assert.deepEqual(report.sourceRepair.map(value => value.eventId), ['c'])
})

test('a verified visible publisher image repairs a failed metadata image', () => {
  const candidate = { eventId: 'a', blockers: [], sourceReadiness: { ready: true } }
  const report = finalizeReadiness({ candidateCount: 1, ready: [candidate], repair: [] }, { results: [{ eventId: 'a', valid: false }] }, { repaired: [{ eventId: 'a', recoveredFrom: 'visible article image', image: { valid: true, url: 'https://publisher.example/photo.jpg' } }] })
  assert.equal(report.generationReadyCount, 1)
  assert.equal(report.generationReady[0].imageProbe.url, 'https://publisher.example/photo.jpg')
})
