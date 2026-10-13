import test from 'node:test'
import assert from 'node:assert/strict'
import { auditEditorialOverlap, qualifyShadowEdition } from './qualify-shadow-edition.mjs'

const card = (eventId, headline, text, url) => ({ eventId, lane: 'world-major', headline, pages: [{ text }], sources: [{ publisher: 'example.com', url }], image: { url: 'https://example.com/image.jpg' } })

test('post-generation overlap audit catches a shared source and strong body overlap', () => {
  const cards = [
    card('a', 'Energy ceasefire disputed after strikes', 'Russia struck energy facilities after an announced ceasefire. Ukraine said no agreement had been completed.', 'https://example.com/story?utm_source=rss'),
    card('b', 'Kremlin rejects proposed energy truce', 'The Kremlin rejected the energy ceasefire after strikes on Ukrainian facilities and said no agreement existed.', 'https://example.com/story'),
    card('c', 'Forest project begins', 'A community began restoring a forest habitat.', 'https://different.example/story'),
  ]
  const pairs = auditEditorialOverlap(cards)
  assert.equal(pairs.length, 1)
  assert.deepEqual(pairs[0].sharedUrls, ['https://example.com/story'])
})

test('qualification removes duplicate cards and trims unrelated context pages', () => {
  const edition = { cardCount: 3, cards: [
    { ...card('a', 'Primary event', 'Central event.', 'https://a.example/story'), pages: [{ text: 'Central event.' }, { text: 'Unrelated repeated context.' }] },
    card('b', 'Duplicate angle', 'Duplicate angle.', 'https://b.example/story'),
    card('c', 'Distinct event', 'Distinct event.', 'https://c.example/story'),
  ] }
  const decisions = { decisions: [
    { eventId: 'a', action: 'retain-pages', pages: [0], reason: 'trim' },
    { eventId: 'b', action: 'remove', retainedEventId: 'a', reason: 'duplicate' },
  ] }
  const qualified = qualifyShadowEdition(edition, decisions)
  assert.equal(qualified.cardCount, 2)
  assert.equal(qualified.cards.find(value => value.eventId === 'a').pages.length, 1)
  assert.equal(qualified.removed[0].eventId, 'b')
})
