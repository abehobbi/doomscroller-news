import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_ACCEPTED_CARDS, prepareVerifiedWriterBatch } from './prepare-verified-writer-batch.mjs'

test('preserves source boundaries when preparing a merged edition for the writer', () => {
  const edition = { cards: [{
    eventId: 'merged-abc', frontPageRank: 1, lane: 'world-major', headline: 'Test event', publishedAt: '2026-10-12T12:00:00Z', priorityRegions: [],
    primaryUrl: 'https://one.test/story', image: { url: 'https://one.test/image.jpg' },
    acceptedSources: [
      { domain: 'one.test', family: 'one', url: 'https://one.test/story', publishedAt: '2026-10-12T12:00:00Z', evidenceText: 'Source one confirms the event happened. It supplies the central fact.' },
      { domain: 'two.test', family: 'two', url: 'https://two.test/report', publishedAt: '2026-10-12T13:00:00Z', evidenceText: 'Source two independently reports the event. It adds useful context.' },
    ],
  }] }
  const prepared = prepareVerifiedWriterBatch(edition)
  assert.equal(prepared.shortlist.selected.length, 1)
  assert.equal(prepared.shortlist.selected[0].independentSourceCount, 2)
  assert.equal(prepared.shortlist.selected[0].evidence, edition.cards[0].acceptedSources[0].evidenceText)
  assert.deepEqual(prepared.verification.results[0].accepted.map(source => source.domain), ['one.test', 'two.test'])
  assert.ok(prepared.verification.results[0].accepted.every(source => source.propositions.length === 2))
})

test('rejects cards whose per-source evidence was discarded', () => {
  assert.throws(() => prepareVerifiedWriterBatch({ cards: [{ eventId: 'broken', acceptedSources: [{ url: 'https://one.test' }] }] }), /no source-bound evidence/)
})

test('the publication batch never exceeds the 65-card hard limit', () => {
  const cards = Array.from({ length: 70 }, (_, index) => ({
    eventId: `event-${index}`, frontPageRank: index + 1, lane: 'world-interesting', headline: `Story ${index}`,
    primaryUrl: `https://source.test/${index}`, priorityRegions: [],
    acceptedSources: [{ domain: 'source.test', family: `source-${index}`, url: `https://source.test/${index}`, evidenceText: `Evidence for story ${index}.` }],
  }))
  const prepared = prepareVerifiedWriterBatch({ cards })
  assert.equal(MAX_ACCEPTED_CARDS, 65)
  assert.equal(prepared.shortlist.selected.length, 65)
  assert.equal(prepared.verification.results.length, 65)
})
