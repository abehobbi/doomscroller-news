import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeVerifiedEditions } from './merge-verified-editions.mjs'

const card = (eventId, headline, url, sources = 1) => ({ eventId, headline, lane: 'world-major', publishedAt: '2026-10-12T00:00:00Z', priorityRegions: [], primaryUrl: url, acceptedSources: Array.from({ length: sources }, (_, index) => ({ domain: `source${index}.test`, family: `source${index}`, url: `${url}/${index}` })), image: { url: `${url}/image.jpg` }, pages: [{ text: 'Facts.' }] })

test('merges recovered cards without duplicating an existing event thread', () => {
  const result = mergeVerifiedEditions([{ cards: [card('old', 'Riyadh airport hit after missile attack', 'https://one.test/a')] }, { cards: [card('new', 'Missile attack hits Riyadh airport', 'https://two.test/b', 2), card('other', 'Roman fort found in Wales', 'https://three.test/c')] }])
  assert.equal(result.cards.length, 2)
  assert.ok(result.cards.some(item => item.sourceEventIds.includes('new')))
  assert.ok(result.cards.some(item => item.sourceEventIds.includes('other')))
})

test('deduplicates an identical headline discovered through different URLs', () => {
  const headline = 'Six Ukrainian energy sites hit by Russia since Trump announced ceasefire, Zelensky says'
  const result = mergeVerifiedEditions([
    { cards: [card('initial', headline, 'https://bbc.test/story')] },
    { cards: [card('recovery', headline, 'https://npr.test/story', 2)] },
  ])
  assert.equal(result.cards.length, 1)
  assert.deepEqual(result.cards[0].sourceEventIds, ['initial', 'recovery'])
})

test('consolidates announcement and response angles on one Russia-Ukraine ceasefire thread', () => {
  const result = mergeVerifiedEditions([{ cards: [
    card('announcement', 'Trump announced a partial Russia-Ukraine ceasefire. Did either country know about it?', 'https://npr.test/a'),
    card('response', 'Zelenskyy says Russia does not want energy ceasefire after strikes on energy facilities', 'https://guardian.test/b', 2),
  ] }, { cards: [] }])
  assert.equal(result.cards.length, 1)
  assert.deepEqual(result.cards[0].sourceEventIds, ['announcement', 'response'])
})

test('retains event aliases when a stronger representative replaces the first card', () => {
  const original = card('original', 'Six Ukrainian energy sites hit by Russia since Trump announced ceasefire, Zelensky says', 'https://one.test/a')
  const broader = card('broader', 'Russian attacks hit Ukrainian energy sites after ceasefire announcement', 'https://two.test/b', 3)
  const repeated = card('repeated', original.headline, 'https://three.test/c', 2)
  const result = mergeVerifiedEditions([{ cards: [original, broader, repeated] }, { cards: [] }])
  assert.equal(result.cards.length, 1)
  assert.deepEqual(result.cards[0].sourceEventIds, ['original', 'broader', 'repeated'])
})

test('does not treat pass-local event ids as global story identities', () => {
  const result = mergeVerifiedEditions([
    { cards: [card('event-005', 'Ghana school receives new digital education equipment', 'https://ghana.test/story')] },
    { cards: [card('event-005', 'New species of deep-sea coral identified', 'https://science.test/story')] },
  ])
  assert.equal(result.cards.length, 2)
  assert.equal(new Set(result.cards.map(item => item.eventId)).size, 2)
})

test('merged event ids are deterministic for the retained canonical source', () => {
  const input = [{ cards: [card('pass-local', 'A distinct retained story', 'https://www.example.test/story?utm_source=feed')] }, { cards: [] }]
  const clean = [{ cards: [card('another-pass', 'A distinct retained story', 'https://example.test/story')] }, { cards: [] }]
  assert.equal(mergeVerifiedEditions(input).cards[0].eventId, mergeVerifiedEditions(clean).cards[0].eventId)
  assert.match(mergeVerifiedEditions(input).cards[0].eventId, /^merged-[a-f0-9]{16}$/)
})
