import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleUnattendedShadowEdition, failedAuditChecks, normalizeGeneratedRouting, rejectionCategory } from './assemble-unattended-shadow-edition.mjs'

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

test('quarantines same-event headlines with a shared action and distinctive subject', () => {
  const shortlist = { selected: [
    input('a', 'world-major', 'Russia and Ukraine agree to local ceasefire in Oleshky'),
    input('b', 'world-major', 'Melania Trump helped broker ceasefire in Russian-occupied Oleshky'),
  ] }
  const report = { expected: 2, resultCount: 2, totalNeurons: 90, results: [
    accepted('a', 'world-major', 'Russia and Ukraine agree to local ceasefire in Oleshky to address humanitarian crisis', 'Local officials described a temporary pause so families could receive supplies.', 'https://source-a.test/oleshky'),
    accepted('b', 'world-major', 'Melania Trump helped broker ceasefire in Russian-occupied Oleshky, White House says', 'The White House described diplomatic contacts that led to a humanitarian arrangement.', 'https://source-b.test/oleshky'),
  ] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.overlaps.length, 1)
  assert.equal(edition.overlaps[0].headlineThreadMatch, true)
  assert.deepEqual(edition.cards.map(card => card.eventId), ['a'])
})

test('does not merge similar events whose headlines identify different locations', () => {
  const shortlist = { selected: [
    input('a', 'world-major', 'Ceasefire begins in Oleshky'),
    input('b', 'world-major', 'Ceasefire begins in Khartoum'),
  ] }
  const report = { expected: 2, resultCount: 2, totalNeurons: 90, results: [
    accepted('a', 'world-major', 'Ceasefire begins in Oleshky after talks', 'Local officials described a temporary pause so displaced families could collect medicine and leave damaged neighbourhoods safely.', 'https://source-a.test/ceasefire'),
    accepted('b', 'world-major', 'Ceasefire begins in Khartoum after talks', 'Aid convoys crossed the capital while negotiators monitored compliance and reopened several roads for commercial traffic.', 'https://source-b.test/ceasefire'),
  ] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.overlaps.length, 0)
  assert.equal(edition.cards.length, 2)
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
    { lane: 'world-interesting', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['Syria'], 'Syrian sailors missing after Black Sea drone strike off Bulgaria'),
    { lane: 'world-interesting', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('world-interesting', [], 'Heiltsuk Nation seeks further spill compensation', 'Heiltsuk Nation still seeking compensation', 'The tug ran aground near Bella Bella, B.C., and spilled fuel in Heiltsuk territory.'),
    { lane: 'priority-interesting', priorityRegions: ['Canada'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('world-interesting', [], 'GAUA says its strike will continue', 'GAUA insists strike will continue', 'The president of the Ghana Association of University Administrators said public universities remain affected.'),
    { lane: 'priority-interesting', priorityRegions: ['Ghana'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('discovery', [], 'Faience workshop reveals Kushite craft production', 'Ancient Nubian temple workshop found', 'The researchers include Kathryn Howley from New York University and Rennan Lemos from Durham University.'),
    { lane: 'discovery', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('discovery', [], 'Volcanic eruption reshaped prehistoric Japan', 'Study examines a 7,300-year-old eruption', 'Professor Peter Jordan said communities adapted after the disaster.'),
    { lane: 'discovery', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('discovery', [], 'Delegates assess global biodiversity progress at COP17', 'Governments review conservation targets', 'The Kunming-Montreal biodiversity framework was adopted in 2022.'),
    { lane: 'discovery', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['Bangladesh'], 'Inflation pushes millions below poverty line in Bangladesh', 'Bangladesh inflation worsens poverty', 'The Middle East crisis also increased imported fuel prices.'),
    { lane: 'priority-interesting', priorityRegions: ['Bangladesh'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('world-interesting', [], 'Russian attacks kill at least 10 and injure dozens across Ukraine'),
    { lane: 'world-major', priorityRegions: [] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['GTA', 'Canada'], 'Ottawa unveils a new downtown mural', 'Artists complete Ottawa mural', 'Related coverage from Toronto appears below the article.'),
    { lane: 'priority-interesting', priorityRegions: ['Canada'] },
  )
  assert.deepEqual(
    normalizeGeneratedRouting('priority-interesting', ['GTA', 'Canada'], 'Regina development breaks ground', 'Regina project begins', 'The publisher also covers Toronto and the GTA.'),
    { lane: 'priority-interesting', priorityRegions: ['Canada'] },
  )
})

test('distinguishes provider quota deferrals from editorial rejection', () => {
  assert.equal(rejectionCategory({ provider: { httpStatus: 429, internalErrors: [{ code: 4006 }] } }), 'provider-deferred')
  assert.equal(rejectionCategory({ status: 'deferred', provider: { structuralStatus: 'provider_deferred' } }), 'provider-deferred')
  assert.equal(rejectionCategory({ provider: { structuralStatus: 'writer_input_evidence_preflight_failure' } }), 'input-rejected')
})

test('reports deterministic checks that use a passes flag', () => {
  assert.deepEqual(failedAuditChecks({
    content: { valid: true },
    writerExposure: { passes: false },
  }), ['writerExposure'])
})
