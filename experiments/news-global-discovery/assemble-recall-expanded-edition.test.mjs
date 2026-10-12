import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleRecallExpandedEdition } from './assemble-recall-expanded-edition.mjs'

test('adds only accepted image-ready cards and preserves a ranked shadow edition', () => {
  const baseline = { cards: [{ eventId: 'old', headline: 'Existing event', lane: 'world-major', pages: [{ text: 'Existing facts.' }], image: { url: 'https://old.test/image.jpg' }, primaryUrl: 'https://old.test/story', priorityRegions: [] }] }
  const shortlist = { selected: [{ eventId: 'new', publishedAt: '2026-10-12T00:00:00Z', priorityRegions: ['Ghana'], primarySource: { url: 'https://new.test/story' }, image: { url: 'https://new.test/image.jpg' } }] }
  const writerReport = { results: [{ eventId: 'new', status: 'accepted', lane: 'priority-major', card: { headline: 'New event', pages: [{ text: 'New facts.' }], uncertainties: [] }, sources: [{ publisher: 'new.test', url: 'https://new.test/story' }], audits: { content: { valid: true } } }] }
  const result = assembleRecallExpandedEdition(baseline, writerReport, shortlist)
  assert.equal(result.cardCount, 2)
  assert.equal(result.additionCount, 1)
  assert.equal(result.imageComplete, true)
  assert.equal(result.auditComplete, true)
  assert.deepEqual(result.cards.map(card => card.frontPageRank), [1, 2])
})
