import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReleaseDataset, mergeMajorUpdateDataset } from './promote-shadow-edition.mjs'

const cards = Array.from({ length: 30 }, (_, index) => ({
  eventId: `event:test-${index + 1}`, headline: `Complete worthwhile headline number ${index + 1}`, publishedAt: '2026-10-30T12:00:00Z',
  pages: [{ text: 'A complete source-bound explanation.' }], primaryUrl: `https://example.com/${index + 1}`,
  sources: [{ publisher: 'Secondary', url: `https://secondary.example.com/${index + 1}` }, { publisher: 'Example', url: `https://example.com/${index + 1}` }],
  image: { url: `https://example.com/${index + 1}.jpg`, publisher: 'Example' }, lane: 'world-interesting', priorityRegions: [],
}))
const edition = { schemaVersion: 1, shadowOnly: true, createdAt: '2026-10-30T20:30:00Z', cards }
const readiness = { strongDailySuccess: true, checks: { exactDailyWindow: true, acceptedMinimum: true, categoryMinimums: true, categoryMaximums: true, hardMaximum: true, completeHeadlines: true, sourceComplete: true, imageComplete: true, recurringBudgetSafe: true } }

test('publication stays locked without explicit release authority', () => assert.throws(() => buildReleaseDataset(edition, readiness), /lock/))
test('every strong-readiness check is required', () => assert.throws(() => buildReleaseDataset(edition, { ...readiness, checks: { ...readiness.checks, recurringBudgetSafe: false } }, { releaseAuthorized: true }), /did not pass/))
test('suggested lane minimums never force rejected filler into an otherwise accepted edition', () => {
  const accepted = { ...readiness, strongDailySuccess: false, checks: { ...readiness.checks, categoryMinimums: false } }
  const dataset = buildReleaseDataset(edition, accepted, { releaseAuthorized: true })
  assert.equal(dataset.cards.length, 30)
  assert.equal(dataset.policy.strongDailySuccess, false)
  assert.equal(dataset.policy.categoryMinimumsMet, false)
})
test('hard lane maximums remain a release gate', () => assert.throws(() => buildReleaseDataset(edition, { ...readiness, checks: { ...readiness.checks, categoryMaximums: false } }, { releaseAuthorized: true }), /did not pass/))
test('a strongly ready edition converts in exact rank order', () => {
  const dataset = buildReleaseDataset(edition, readiness, { releaseAuthorized: true })
  assert.equal(dataset.cards.length, 30)
  assert.deepEqual(dataset.feed.eventIds, dataset.cards.map(card => card.event_id))
  assert.equal(dataset.policy.strongDailySuccess, true)
  assert.equal(dataset.cards[0].sources[0].name, 'Example')
})

test('pipeline event IDs are converted to the stable hosted schema', () => {
  const legacyEdition = { ...edition, cards: cards.map((card, index) => ({ ...card, eventId: `event-${String(index + 1).padStart(3, '0')}` })) }
  const dataset = buildReleaseDataset(legacyEdition, readiness, { releaseAuthorized: true })
  assert.equal(dataset.cards[0].event_id, 'event:001')
  assert.equal(dataset.feed.eventIds[29], 'event:030')
})

test('evening major updates replace matching events and retain the morning edition', () => {
  const base = buildReleaseDataset(edition, readiness, { releaseAuthorized: true })
  const updateCard = { ...cards[0], lane: 'world-major', headline: 'A materially updated major headline', frontPageRank: 1 }
  const newCard = { ...cards[1], eventId: 'event:new-major', lane: 'priority-major', headline: 'A genuinely new major development', frontPageRank: 2 }
  const updateEdition = { ...edition, createdAt: '2026-10-31T00:30:00Z', cards: [updateCard, newCard] }
  const updateReadiness = { windowHours: 12, checks: { categoryMaximums: true, hardMaximum: true, completeHeadlines: true, sourceComplete: true, imageComplete: true, recurringBudgetSafe: true } }
  const merged = mergeMajorUpdateDataset(base, updateEdition, updateReadiness, { releaseAuthorized: true })
  assert.deepEqual(merged.feed.eventIds.slice(0, 2), ['event:test-1', 'event:new-major'])
  assert.equal(merged.cards.find(card => card.event_id === 'event:test-1').content_version, 2)
  assert.equal(merged.cards.find(card => card.event_id === 'event:test-1').first_seen, base.cards[0].first_seen)
  assert.equal(merged.cards.length, base.cards.length + 1)
})

test('evening promotion extracts only major cards and rejects weak update readiness', () => {
  const base = buildReleaseDataset(edition, readiness, { releaseAuthorized: true })
  const updateReadiness = { windowHours: 12, checks: { categoryMaximums: true, hardMaximum: true, completeHeadlines: true, sourceComplete: true, imageComplete: true, recurringBudgetSafe: true } }
  const major = { ...cards[1], eventId: 'event:evening-major', lane: 'world-major', headline: 'A verified evening major development' }
  const merged = mergeMajorUpdateDataset(base, { ...edition, cards: [cards[0], major, cards[2]] }, updateReadiness, { releaseAuthorized: true })
  assert.equal(merged.policy.updateCards, 1)
  assert.equal(merged.cards[0].event_id, 'event:evening-major')
  assert.equal(merged.cards.some(card => card.event_id === 'event:test-1' && card.content_version === 2), false)
  assert.equal(mergeMajorUpdateDataset(base, { ...edition, cards: [cards[0]] }, updateReadiness, { releaseAuthorized: true }), base)
  assert.throws(() => mergeMajorUpdateDataset(base, { ...edition, cards: [major] }, { ...updateReadiness, checks: { ...updateReadiness.checks, sourceComplete: false } }, { releaseAuthorized: true }), /readiness/)
})
