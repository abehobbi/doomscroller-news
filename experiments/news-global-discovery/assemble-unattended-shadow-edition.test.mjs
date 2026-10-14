import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleUnattendedShadowEdition, normalizeGeneratedRouting, rejectionCategory } from './assemble-unattended-shadow-edition.mjs'

const input = (eventId, lane, headline) => ({ eventId, lane, headline, publishedAt: '2026-10-12T12:00:00Z', priorityRegions: [], image: { url: `https://img.test/${eventId}.jpg`, publisher: 'img.test' }, primarySource: { url: `https://source.test/${eventId}` } })
const accepted = (eventId, lane, headline, text, url = `https://source.test/${eventId}`) => ({ eventId, lane, sourceTitle: headline, status: 'accepted', card: { headline, pages: [{ text }], uncertainties: [] }, sources: [{ publisher: 'source.test', url }], audits: { content: { valid: true } }, provider: { complete: true } })

test('assembles accepted cards and preserves deterministic rejections', () => {
  const shortlist = { selected: [input('a', 'world-major', 'Airport attack'), input('b', 'discovery', 'Fossil study')] }
  const report = { expected: 2, resultCount: 2, totalNeurons: 80, results: [accepted('a', 'world-major', 'Airport attack kills civilians', 'A missile attack killed civilians at an airport.'), { eventId: 'b', sourceTitle: 'Fossil study', status: 'rejected', provider: { complete: true }, audits: { numbers: { valid: false } } }] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.accepted, 1)
  assert.equal(edition.rejected.length, 1)
  assert.deepEqual(edition.rejected[0].failedChecks, ['numbers'])
  assert.equal(edition.requiresEditorialReview, true)
})

test('quarantines the lower-ranked generated card when cards share a canonical source URL', () => {
  const shortlist = { selected: [input('a', 'world-major', 'First event'), input('b', 'world-interesting', 'Second event')] }
  const shared = 'https://source.test/shared'
  const report = { expected: 2, resultCount: 2, totalNeurons: 90, results: [accepted('a', 'world-major', 'First event develops', 'One distinct development happened.', shared), accepted('b', 'world-interesting', 'Second event develops', 'Another distinct development happened.', shared)] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.overlaps.length, 1)
  assert.equal(edition.cards.length, 1)
  assert.equal(edition.cards[0].eventId, 'a')
  assert.equal(edition.rejected.at(-1).failedChecks[0], 'post-generation overlap')
  assert.equal(edition.requiresEditorialReview, true)
})

test('retains an explicitly approved image exception without inventing an image', () => {
  const noImage = { ...input('a', 'world-major', 'Important inaccessible-image story'), image: null, imageException: { granted: true, reason: 'recovery exhausted' } }
  const shortlist = { selected: [noImage] }
  const report = { expected: 1, resultCount: 1, totalNeurons: 40, results: [accepted('a', 'world-major', 'Important story remains available', 'A consequential event happened and was independently verified.')] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.cards.length, 1)
  assert.equal(edition.cards[0].image, null)
  assert.equal(edition.cards[0].imageException.granted, true)
})

test('routes generated priority-region headlines back into priority lanes', () => {
  assert.deepEqual(
    normalizeGeneratedRouting('world-interesting', [], 'Ghanaian universities prepare to reopen after strike'),
    { lane: 'priority-interesting', priorityRegions: ['Ghana'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('world-major', [], 'Bangladesh begins first nuclear reaction at Rooppur'),
    { lane: 'priority-major', priorityRegions: ['Bangladesh'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['Middle East'], 'Former engineer charged in San Francisco', 'OpenAI engineer charged after listening device found'),
    { lane: 'priority-interesting', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['Syria'], 'Syrian sailors missing after Black Sea drone strike'),
    { lane: 'priority-interesting', priorityRegions: ['Syria'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('world-interesting', [], 'Russian attacks kill at least 10 and injure dozens across Ukraine'),
    { lane: 'world-major', priorityRegions: [] },
  )
})

test('distinguishes provider quota deferrals from editorial rejection', () => {
  assert.equal(rejectionCategory({ provider: { httpStatus: 429, internalErrors: [{ code: 4006 }] } }), 'provider-deferred')
  assert.equal(rejectionCategory({ status: 'deferred', provider: { structuralStatus: 'provider_deferred' } }), 'provider-deferred')
  assert.equal(rejectionCategory({ provider: { structuralStatus: 'writer_input_evidence_preflight_failure' } }), 'input-rejected')
})
