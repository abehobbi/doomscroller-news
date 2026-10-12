import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeVerifiedEditions } from './merge-verified-editions.mjs'

const card = (eventId, headline, url, sources = 1) => ({ eventId, headline, lane: 'world-major', publishedAt: '2026-10-12T00:00:00Z', priorityRegions: [], primaryUrl: url, acceptedSources: Array.from({ length: sources }, (_, index) => ({ domain: `source${index}.test`, family: `source${index}`, url: `${url}/${index}` })), image: { url: `${url}/image.jpg` }, pages: [{ text: 'Facts.' }] })

test('merges recovered cards without duplicating an existing event thread', () => {
  const result = mergeVerifiedEditions([{ cards: [card('old', 'Riyadh airport hit after missile attack', 'https://one.test/a')] }, { cards: [card('new', 'Missile attack hits Riyadh airport', 'https://two.test/b', 2), card('other', 'Roman fort found in Wales', 'https://three.test/c')] }])
  assert.equal(result.cards.length, 2)
  assert.ok(result.cards.some(item => item.eventId === 'new'))
  assert.ok(result.cards.some(item => item.eventId === 'other'))
})
