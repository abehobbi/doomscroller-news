import test from 'node:test'
import assert from 'node:assert/strict'
import { PROMOTED_EVENT_IDS, prepareRecallWriterTrial } from './prepare-recall-writer-trial.mjs'

test('prepares only promoted events and source-bound verification propositions', () => {
  const events = [...PROMOTED_EVENT_IDS].map((id, index) => ({ id, representative: { selection: { assignedLane: 'world-major', representative: { priorityRegions: [] } }, snapshot: { title: `Story ${index}`, publishedAt: '2026-10-12T00:00:00Z', publisher: 'example.com', sourceUrl: `https://example.com/${index}`, evidenceText: 'A complete factual sentence supplies enough evidence.' } } }))
  const ready = events.map((event, index) => ({ eventId: `recall-${index}`, readiness: { ready: true, independentSourceFamilies: 1, image: { url: `https://example.com/${index}.jpg` } }, sources: [{ accepted: true, url: `https://example.com/${index}`, domain: 'example.com', publishedAt: '2026-10-12T00:00:00Z', evidenceText: 'A verified supporting proposition is present.' }] }))
  const result = prepareRecallWriterTrial({ events }, { ready }, { results: [] })
  assert.equal(result.shortlist.selected.length, 5)
  assert.equal(result.verification.results.length, 5)
  assert.ok(result.verification.results.every(item => item.accepted[0].propositions.length === 1))
})
