import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleCorrectedEdition, FINAL_EVENT_IDS } from './assemble-corrected-shadow-edition.mjs'

test('corrected edition requires every final card and a publisher image', () => {
  const results = FINAL_EVENT_IDS.map(eventId => ({
    eventId, lane: 'world-interesting', status: 'accepted',
    card: { headline: eventId, pages: [{ text: 'Complete text.' }] },
    sources: [{ publisher: 'example.com', url: `https://example.com/${eventId}` }],
    audits: {}, provider: { complete: true },
  }))
  const items = FINAL_EVENT_IDS.map(eventId => ({ sourceUrl: `https://example.com/${eventId}`, imageUrl: `https://example.com/${eventId}.jpg`, publisher: 'example.com' }))
  const edition = assembleCorrectedEdition([{ results }], { items })
  assert.equal(edition.cardCount, 20)
  assert.equal(edition.everyCardHasPublisherImage, true)
  assert.throws(() => assembleCorrectedEdition([{ results: results.slice(1) }], { items }), /Missing final events/)
})
