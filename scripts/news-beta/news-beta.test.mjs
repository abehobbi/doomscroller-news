import test from 'node:test'
import assert from 'node:assert/strict'
import { validateNewsBetaDataset, articlesForFeed } from '../../src/news/schema.js'
import {
  applyBetaSelectionPolicy, buildDiscoveryPool, classifyCardRegions, classifyPriorityRegions, clearsGenerationQualityFloor,
  consolidatePublishedCards, diversityRerank, htmlListingItems, isEditoriallyEligibleTitle, sanitizeRetainedCard,
  selectActiveFeedCards, wordpressJsonItems,
} from './pipeline.mjs'
import { normalizeFeedItem } from '../news/normalize.mjs'
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

test('public HTML listings yield dated publisher articles and original images', () => {
  const html = `<article><a href="/health/dengue-update"><img src="/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fdengue.jpg&amp;w=1200&amp;q=75"></a><time dateTime="2026-10-03T13:47:54+00:00">5 hours ago</time><h3><a href="/health/dengue-update">Six more die of dengue; 1,608 hospitalised</a></h3></article>`
  const items = htmlListingItems(html, 'https://publisher.example/')
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Six more die of dengue; 1,608 hospitalised')
  assert.equal(items[0].link, 'https://publisher.example/health/dengue-update')
  assert.equal(items[0].pubDate, '2026-10-03T13:47:54+00:00')
  assert.equal(items[0].enclosure['@_url'], 'https://cdn.example.com/dengue.jpg')
})

test('public WordPress JSON yields Ghana agency stories without scraping private data', () => {
  const items = wordpressJsonItems(JSON.stringify([{
    date_gmt: '2026-10-03T22:14:54', link: 'https://gna.org.gh/2026/10/example/',
    title: { rendered: 'District assemblies begin broadcasting meetings in local languages' },
    excerpt: { rendered: '<p>A public-interest local government development.</p>' },
    jetpack_featured_media_url: 'https://gna.org.gh/example.jpg',
  }]))
  assert.equal(items.length, 1)
  assert.equal(items[0].pubDate, '2026-10-03T22:14:54Z')
  assert.equal(items[0].description, 'A public-interest local government development.')
  assert.equal(items[0].enclosure['@_url'], 'https://gna.org.gh/example.jpg')
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
  assert.deepEqual(classifyCardRegions({ headline: 'Indian official discusses Sheikh Hasina landing in Delhi', sources: [{ name: 'Prothom Alo English' }] }), ['Bangladesh'])
  assert.deepEqual(classifyPriorityRegions(base('Trump orders US government to rename an AI program', 'sana-en')), [])
  assert.deepEqual(classifyPriorityRegions({
    primary: { title: 'Paris police respond to student protests' },
    articles: [{
      title: 'Paris police respond to student protests', provenance: { feedId: 'north-press-en' },
      geography: { eventLocations: [{ name: 'France', region: 'Europe' }], priorityRegions: [] },
    }],
  }), [])
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
  assert.equal(applyBetaSelectionPolicy(make('How an unchanged policy may affect households')).scoreParts.editorialPenalty, -18)
  assert.equal(applyBetaSelectionPolicy(make('Trump the environmentalist? How a policy changed')).scoreParts.editorialPenalty, -18)
  assert.equal(applyBetaSelectionPolicy(make('Two local journalists selected for UK fellowship')).scoreParts.editorialPenalty, -30)
  assert.equal(isEditoriallyEligibleTitle('Sydney Hushie appointed Chief of a digital centre'), false)
  assert.equal(isEditoriallyEligibleTitle('Niagara invites neighbours to a red-white-blue falls display'), false)
  assert.equal(isEditoriallyEligibleTitle('Australia’s best home gardens – in pictures'), false)
  assert.equal(isEditoriallyEligibleTitle('Library Authority signs MoU with youth federation'), false)
  assert.equal(isEditoriallyEligibleTitle('Zambia holds its closest election in decades'), true)
  assert.ok(applyBetaSelectionPolicy(make('Library Authority partners with youth federation')).scoreParts.editorialPenalty <= -18)
})

test('reranker reserves meaningful space for priority and world discovery', () => {
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
  const result = diversityRerank(candidates, { target: 20, maximum: 20 })
  assert.equal(result.selected.length, 20)
  assert.equal(result.selected.filter(value => value.event.regions.includes('Bangladesh')).length, 2)
  assert.ok(result.selected.some(value => value.event.id === 'lithuania'))
  assert.ok(result.selected.some(value => value.event.id === 'zambia'))
  assert.deepEqual(result.selected.map(value => value.selection.rank), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.ok(result.selected.every(value => Number.isFinite(value.selection.adjustedScore)))
})

test('generation quality is a floor rather than a per-run quota', () => {
  assert.equal(clearsGenerationQualityFloor({ selection: { adjustedScore: 30 } }), true)
  assert.equal(clearsGenerationQualityFloor({ selection: { adjustedScore: 29.99 } }), false)
  assert.equal(clearsGenerationQualityFloor({}), false)
})

test('RSS headlines wrapped in an anchor remain valid discoverable articles', () => {
  const article = normalizeFeedItem({
    title: { a: { '#text': 'Six more die of dengue, 1,608 get hospitalised', '@_href': '/story' } },
    link: 'https://www.thedailystar.net/news/bangladesh/news/dengue',
    pubDate: 'Sun, 04 Oct 26 00:00:00 +0600',
    guid: 'daily-star-dengue',
  }, {
    id: 'daily-star-bd', publisherId: 'daily-star-bd', name: 'The Daily Star Bangladesh',
    sourceUrl: 'https://www.thedailystar.net/', feedUrl: 'https://www.thedailystar.net/news/bangladesh/rss.xml',
    topics: ['Bangladesh'], regions: ['Bangladesh'], language: 'en',
  }, '2026-10-04T02:00:00Z')
  assert.equal(article.title, 'Six more die of dengue, 1,608 get hospitalised')
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

test('a shared country and generic attack word cannot merge unrelated events', () => {
  const article = (title, publishedAt) => ({ title, description: '', publishedAt })
  const result = compareEvents(
    article('OpenAI Medicare attack exposes Australia tech debt', '2026-10-03T01:00:00Z'),
    article('Flydubai co-pilot investigated in Australia after cockpit attack', '2026-10-04T01:00:00Z'),
  )
  assert.equal(result.relation, 'distinct-or-uncertain')
})

test('retained cards shed unrelated sources from a previously contaminated cluster', () => {
  const cleaned = sanitizeRetainedCard(card('mixed-event', {
    headline: 'OpenAI Medicare breach prompts Australian legacy technology review',
    geography: ['Middle East'],
    sources: [
      { name: 'Guardian', url: 'https://example.com/openai-medicare-australia-legacy-technology', role: 'primary' },
      { name: 'Guardian', url: 'https://example.com/flydubai-pilot-australia-cockpit-attack', role: 'additional' },
      { name: 'BBC', url: 'https://example.com/flydubai-copilot-crash-axe', role: 'additional' },
      { name: 'Other', url: 'https://example.com/openai-medicare-breach-review', role: 'additional' },
    ],
  }))
  assert.deepEqual(cleaned.sources.map(source => source.url), [
    'https://example.com/openai-medicare-australia-legacy-technology',
    'https://example.com/openai-medicare-breach-review',
  ])
  assert.deepEqual(cleaned.geography, [])
})

test('active feed keeps twenty cards while preserving priority coverage and world space', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  const activeCard = (id, geography, hoursAgo) => card(id, { headline: `Material development ${id}`, geography, updated_at: new Date(now - hoursAgo * 3_600_000).toISOString() })
  const cards = [
    activeCard('syria-1', ['Syria', 'Middle East'], 1), activeCard('syria-2', ['Syria', 'Middle East'], 2),
    activeCard('bangladesh-1', ['Bangladesh'], 3), activeCard('bangladesh-2', ['Bangladesh'], 4),
    activeCard('ghana-1', ['Ghana'], 5), activeCard('ghana-2', ['Ghana'], 6),
    activeCard('canada-1', ['Canada'], 7), activeCard('gta-1', ['GTA', 'Canada'], 8),
    ...Array.from({ length: 18 }, (_, index) => activeCard(`world-${index}`, [], 9 + index)),
  ]
  const selected = selectActiveFeedCards(cards, { now })
  assert.equal(selected.length, 20)
  assert.equal(selected.filter(value => value.geography.includes('Bangladesh')).length, 2)
  assert.ok(selected.filter(value => !value.geography.length).length >= 8)
})

test('shared protest language cannot merge events in two explicitly different countries', () => {
  const article = (title, publishedAt) => ({ title, description: '', publishedAt })
  const result = compareEvents(
    article('Police respond as student protests spread across Paris, France', '2026-10-03T08:00:00Z'),
    article('Police respond as student protests spread across Damascus, Syria', '2026-10-03T07:00:00Z'),
  )
  assert.equal(result.relation, 'distinct-or-uncertain')
  assert.equal(result.reason, 'explicit event locations conflict')
})

test('evidence discovery gives low-volume feeds a chance before large feeds fill the pool', () => {
  const event = (id, feedId) => ({ id, articles: [{ provenance: { feedId } }] })
  const events = [
    ...Array.from({ length: 20 }, (_, index) => event(`large-${index}`, 'large-feed')),
    event('ghana-agency', 'ghana-news-agency'), event('japan-local', 'japan-times'), event('conservation', 'mongabay'),
  ]
  const pool = buildDiscoveryPool(events, { maximum: 8, perFeed: 2 })
  assert.ok(pool.some(value => value.id === 'ghana-agency'))
  assert.ok(pool.some(value => value.id === 'japan-local'))
  assert.ok(pool.some(value => value.id === 'conservation'))
})

test('active feed expands above twenty only for fresh qualified cards and stops at thirty', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  const cards = Array.from({ length: 34 }, (_, index) => card(`quality-${index}`, {
    headline: `Distinct material development number ${index} changes public policy`,
    geography: index % 6 === 0 ? ['Bangladesh'] : [], selection_score: 55,
    sources: [{ name: `Publisher ${index % 12}`, url: `https://example.com/quality-${index}`, role: 'primary', publishedAt: '2026-10-03T10:00:00Z' }],
    updated_at: new Date(now - index * 20 * 60_000).toISOString(),
  }))
  assert.equal(selectActiveFeedCards(cards, { now }).length, 30)
  cards.slice(20).forEach(value => { value.selection_score = 40 })
  assert.equal(selectActiveFeedCards(cards, { now }).length, 20)
})

test('retained cross-run duplicates become one multi-source event card', () => {
  const left = card('manchester-a', {
    headline: 'Two Iranian men charged in alleged Manchester synagogue plot', geography: ['Middle East'],
    updated_at: '2026-10-03T10:00:00Z',
    sources: [{ name: 'Source A', url: 'https://example.com/a', role: 'primary', publishedAt: '2026-10-03T08:00:00Z' }],
  })
  const right = card('manchester-b', {
    headline: 'Two Iranians charged over alleged Manchester synagogue attack plot', geography: ['Middle East'],
    updated_at: '2026-10-03T11:00:00Z',
    sources: [{ name: 'Source B', url: 'https://example.com/b', role: 'primary', publishedAt: '2026-10-03T09:00:00Z' }],
  })
  const result = consolidatePublishedCards([left, right])
  assert.equal(result.length, 1)
  assert.equal(result[0].sources.length, 2)
  assert.deepEqual(result[0].sources.map(source => source.role), ['primary', 'additional'])
})

test('same named incident consolidates despite different headline wording', () => {
  const incident = (id, headline, hour) => card(id, {
    headline, geography: id === 'flydubai-b' ? [] : ['Middle East'],
    updated_at: `2026-10-03T${hour}:00:00Z`,
    sources: [{ name: `Source ${id}`, url: `https://example.com/${id}`, role: 'primary', publishedAt: `2026-10-03T${hour}:00:00Z` }],
  })
  const result = consolidatePublishedCards([
    incident('flydubai-a', 'Co-pilot attack on Flydubai flight leads to emergency landing in Saudi Arabia', '10'),
    incident('flydubai-b', 'Pilot describes cockpit attack by co-pilot on Flydubai flight', '11'),
    incident('flydubai-c', 'Flydubai pilot allegedly stabs co-pilot during flight from UAE to Israel', '12'),
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].sources.length, 3)
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
