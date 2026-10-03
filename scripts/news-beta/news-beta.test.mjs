import test from 'node:test'
import assert from 'node:assert/strict'
import { validateNewsBetaDataset, articlesForFeed } from '../../src/news/schema.js'
import { applyBetaSelectionPolicy, classifyCardRegions, classifyPriorityRegions, diversityRerank, isEditoriallyEligibleTitle } from './pipeline.mjs'
import { validateCardContent } from './content-validation.mjs'
import { displayStoryPages } from '../../src/news/pagination.js'
import { compareEvents } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

const card = (id, overrides = {}) => ({
  event_id: id, headline: `Headline for ${id}`, pages: [{ text: 'A complete source-grounded explanation.' }],
  uncertainties: [], image: { url: null, alt: null, status: 'fallback', source_url: null, attribution: null },
  sources: [{ name: 'Publisher', url: `https://example.com/${id}`, role: 'primary', publishedAt: '2026-09-25T10:00:00Z' }],
  geography: ['World'], topics: [], first_seen: '2026-09-25T10:00:00Z', updated_at: '2026-09-25T10:00:00Z',
  generated_at: '2026-09-25T10:01:00Z', evidence_fingerprint: 'a'.repeat(64), content_version: 1, ...overrides,
})

test('beta schema preserves event cards, pages, sources and stable ids', () => {
  const dataset = { schema: 'doomscroller.news-beta-dataset', schemaVersion: 1, generatedAt: '2026-09-25T10:01:00Z', feed: { eventIds: ['event:alpha1'] }, cards: [card('event:alpha1')] }
  const valid = validateNewsBetaDataset(dataset)
  assert.ok(valid)
  assert.equal(valid.cards[0].id, 'event:alpha1')
  assert.equal(valid.cards[0].pages.length, 1)
  assert.equal(valid.cards[0].sources[0].role, 'primary')
  assert.deepEqual(articlesForFeed(dataset).map(item => item.id), ['event:alpha1'])
})

test('beta schema rejects empty output and unsafe primary URLs', () => {
  assert.equal(validateNewsBetaDataset({ schema: 'doomscroller.news-beta-dataset', schemaVersion: 1, generatedAt: '2026-09-25', feed: { eventIds: [] }, cards: [] }), null)
  const dataset = { schema: 'doomscroller.news-beta-dataset', schemaVersion: 1, generatedAt: '2026-09-25', feed: { eventIds: ['event:alpha1'] }, cards: [card('event:alpha1', { sources: [{ name: 'Bad', url: 'javascript:alert(1)', role: 'primary' }] })] }
  assert.equal(validateNewsBetaDataset(dataset), null)
})

test('diversity reranker only adjusts already-qualified events and records adjustments', () => {
  const item = (id, score, regions, title, publisher = 'Publisher') => ({
    event: { id, score, regions, primary: { title, description: '', url: 'https://example.com' } },
    packet: { primaryNarrativeSource: { publisher } },
  })
  const input = [
    item('event:syria1', 60, ['Syria'], 'Leaders meet for diplomatic talks'),
    item('event:syria2', 58, ['Syria'], 'Minister gives diplomatic speech'),
    item('event:ghana1', 55, ['Ghana'], 'Scientists announce archaeological discovery', 'Other'),
    item('event:weak01', 20, ['Bangladesh'], 'Minor ceremony'),
  ]
  const result = diversityRerank(input, { target: 3, maximum: 3, minimumScore: 38 })
  assert.equal(result.selected.length, 3)
  assert.ok(!result.selected.some(value => value.event.id === 'event:weak01'))
  assert.equal(result.adjustments.length, 3)
  assert.ok(result.adjustments.some(value => value.eventId === 'event:ghana1' && value.adjustment > 0))
})

test('beta selection uses event geography instead of publisher location', () => {
  const base = (title, feedId, regions = ['Middle East']) => ({
    primary: { title, provenance: { feedId } }, articles: [{ title }], regions, score: 45,
    scoreParts: { region: 15, importance: 18 },
  })
  assert.deepEqual(classifyPriorityRegions(base('US and China extend a trade truce', 'aljazeera-all')), [])
  assert.deepEqual(classifyPriorityRegions(base('Explosion reported in Daraa countryside', 'guardian-world')), ['Syria', 'Middle East'])
  assert.deepEqual(classifyPriorityRegions(base('Mahama addresses parliament', 'myjoyonline')), ['Ghana'])
  assert.equal(applyBetaSelectionPolicy(base('US and China extend a trade truce', 'aljazeera-all')).scoreParts.region, 0)
  assert.deepEqual(classifyCardRegions({ headline: 'US and China extend a trade truce', sources: [{ name: 'Al Jazeera' }] }), [])
  assert.deepEqual(classifyCardRegions({ headline: 'Toronto city budget is approved', sources: [{ name: 'CBC Toronto' }] }), ['GTA', 'Canada'])
  assert.deepEqual(classifyPriorityRegions(base('Trump orders US government to rename an AI program', 'sana-en')), [])
  assert.deepEqual(classifyPriorityRegions({
    primary: { title: 'Election Commission announces new polling timetable' },
    articles: [{ title: 'Election Commission announces new polling timetable', provenance: { feedId: 'dhaka-tribune' } }],
  }), ['Bangladesh'])
  assert.deepEqual(classifyPriorityRegions({
    primary: { title: 'Trump announces a new US technology program' },
    articles: [{ title: 'Trump announces a new US technology program', provenance: { feedId: 'dhaka-tribune' } }],
  }), [])
})

test('beta selection demotes routine sports and generic explainer cards', () => {
  const make = title => ({ primary: { title, provenance: { feedId: 'cbc-toronto' } }, articles: [{ title }], regions: ['GTA'], score: 40, scoreParts: { region: 18, importance: 6 } })
  assert.equal(applyBetaSelectionPolicy(make('Raptors GM discusses basketball trade')).scoreParts.editorialPenalty, -18)
  assert.equal(applyBetaSelectionPolicy(make('How an unchanged policy may affect households')).scoreParts.editorialPenalty, -12)
  assert.equal(applyBetaSelectionPolicy(make('Two local journalists selected for UK fellowship')).scoreParts.editorialPenalty, -30)
  assert.equal(isEditoriallyEligibleTitle('Sydney Hushie appointed Chief of a digital centre'), false)
  assert.equal(isEditoriallyEligibleTitle('Niagara invites neighbours to a red-white-blue falls display'), false)
  assert.equal(isEditoriallyEligibleTitle('Zambia holds its closest election in decades'), true)
})

test('twenty-card reranker reserves meaningful space for priority and world discovery', () => {
  const item = (id, score, regions, title, discovery = 0) => ({
    event: { id, score, regions, scoreParts: { discovery }, primary: { title, description: '', url: 'https://example.com' }, articles: [{ title, description: '' }] },
    packet: { primaryNarrativeSource: { publisher: `Publisher ${id}` } },
  })
  const candidates = [
    item('bangladesh-1', 45, ['Bangladesh'], 'Election Commission sets national vote timetable'),
    item('bangladesh-2', 44, ['Bangladesh'], 'Court issues major constitutional ruling in Dhaka'),
    item('lithuania', 43, [], 'Lithuania reports first archaeological discovery', 10),
    item('zambia', 42, [], 'Zambia conservation researchers discover new species', 10),
    ...Array.from({ length: 20 }, (_, index) => item(`world-${index}`, 60 - index, [], `Major world event ${index}`)),
  ]
  const result = diversityRerank(candidates)
  assert.equal(result.selected.length, 20)
  assert.equal(result.selected.filter(value => value.event.regions.includes('Bangladesh')).length, 2)
  assert.ok(result.selected.some(value => value.event.id === 'lithuania'))
  assert.ok(result.selected.some(value => value.event.id === 'zambia'))
})

test('near-identical international headlines cluster even before a country is in the place dictionary', () => {
  const article = (title, hour) => ({
    title, description: '', publishedAt: `2026-10-03T0${hour}:00:00Z`,
    signals: { actor: [], place: [], headlineAction: ['elect'], action: ['elect'], numbers: [], terms: title.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/) },
  })
  const result = compareEvents(
    article('Latvia votes in parliamentary election amid rising costs', 8),
    article('Latvians vote in parliamentary election amid rising cost concerns', 7),
  )
  assert.equal(result.relation, 'same-event')
})

test('content gate rejects thin, truncated, and exposed citation-marker prose', () => {
  const good = { headline: 'A factual headline', pages: [{ text: `${'Supported context and material detail are stated clearly. '.repeat(9)}The development matters because the supplied reporting establishes its practical effect.` }] }
  assert.equal(validateCardContent(good).valid, true)
  assert.match(validateCardContent({ headline: 'Thin', pages: [{ text: 'Too short.' }] }).reasons.join(' '), /too thin/)
  assert.match(validateCardContent({ headline: 'Cut off', pages: [{ text: 'A complete-looking explanation '.repeat(20) }] }).reasons.join(' '), /mid-sentence/)
  assert.match(validateCardContent({ headline: 'Markers', pages: [{ text: `${'Supported material explains the event in adequate detail. '.repeat(8)}Done. 1. More prose follows with enough words to pass the ordinary size gate.` }] }).reasons.join(' '), /citation/)
})

test('long generated prose is split into readable display pages without losing words', () => {
  const text = Array.from({ length: 18 }, (_, index) => `Sentence ${index + 1} contains enough factual words to make the phone layout readable.`).join(' ')
  const pages = displayStoryPages([{ text }], { targetWords: 45, maximumWords: 58 })
  assert.ok(pages.length > 1)
  assert.equal(pages.map(page => page.text).join(' ').split(/\s+/).length, text.split(/\s+/).length)
  assert.ok(pages.every(page => page.text.length > 0 && /[.!?]$/.test(page.text)))
})
