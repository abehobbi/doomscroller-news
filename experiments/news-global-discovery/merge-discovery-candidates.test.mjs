import test from 'node:test'
import assert from 'node:assert/strict'
import { majorEligible, mergeDiscoveryCandidates, regionMatchesText, sourceCandidate } from './merge-discovery-candidates.mjs'

function feedItem(overrides = {}) {
  return {
    event: {
      primary: { title: 'Ghana farmers restore a community wetland', url: 'https://example.com/story?utm_source=rss', publishedAt: '2026-10-11T10:00:00Z', sourceId: 'local', provenance: { feedId: 'local-feed' } },
      regions: ['Ghana'], scoreParts: { importance: 18, localTexture: 7 },
    }, image: { url: 'https://example.com/image.jpg' }, ...overrides,
  }
}

test('publisher candidates retain priority geography and receive an editorial lane', () => {
  const candidate = sourceCandidate(feedItem())
  assert.deepEqual(candidate.priorityRegions, ['Ghana'])
  assert.deepEqual(candidate.lanes, ['priority-interesting'])
  assert.equal(candidate.image, 'https://example.com/image.jpg')
})

test('canonical URL overlap merges Exa and publisher-feed discovery before selection', () => {
  const exa = { candidates: [{ title: 'Ghana farmers restore a community wetland', url: 'https://www.example.com/story', lanes: ['world-interesting'], priorityRegions: [], queryIds: ['open'], bestPosition: 3 }], rawResultCount: 1 }
  const source = { candidates: [feedItem()], counts: { freshArticles: 1 } }
  const report = mergeDiscoveryCandidates(exa, source)
  assert.equal(report.uniqueCandidateCount, 1)
  assert.deepEqual(report.candidates[0].discoverySources, ['exa', 'publisher-feed'])
  assert.deepEqual(report.candidates[0].priorityRegions, ['Ghana'])
  assert.equal(report.inputCounts.mergedByCanonicalUrl, 1)
})

test('a locally interesting project is not promoted to major news without a concrete headline action', () => {
  const candidate = sourceCandidate(feedItem({ event: { ...feedItem().event, scoreParts: { importance: 30, consequence: 0, localTexture: 7 } } }))
  assert.deepEqual(candidate.lanes, ['priority-interesting'])
})

test('known local publishers restore priority geography only when the event text supports it', () => {
  const exa = { candidates: [{ title: 'Bangladesh river erosion forces farmers to harvest early', url: 'https://www.thedailystar.net/news/story', lanes: ['world-interesting'], priorityRegions: [], queryIds: ['world-local'], bestPosition: 2 }], rawResultCount: 1 }
  const report = mergeDiscoveryCandidates(exa, { candidates: [], counts: { freshArticles: 0 } })
  assert.deepEqual(report.candidates[0].priorityRegions, ['Bangladesh'])
  assert.deepEqual(report.candidates[0].lanes, ['world-interesting', 'priority-interesting'])
})

test('a foreign syndicated story does not inherit the publisher home country', () => {
  const foreign = feedItem({ event: { ...feedItem().event, primary: { ...feedItem().event.primary, title: 'Christa Pike returns to Nashville prison after failed execution' } } })
  const candidate = sourceCandidate(foreign)
  assert.deepEqual(candidate.priorityRegions, [])
  assert.deepEqual(candidate.lanes, ['world-interesting'])
})

test('priority-region signals recognize common local places and political abbreviations', () => {
  assert.equal(regionMatchesText('Ghana', 'Tema residents protest water shortages'), true)
  assert.equal(regionMatchesText('Bangladesh', 'Former BNP lawmaker dies at 80'), true)
  assert.equal(regionMatchesText('Canada', 'Durham police warn parents about online predators'), true)
  assert.equal(regionMatchesText('GTA', 'Durham police warn parents about online predators'), true)
  assert.equal(regionMatchesText('Canada', 'B.C. premier defends child-care access'), true)
  assert.equal(regionMatchesText('GTA', 'Torontonians report feeling unsafe after dark'), true)
})

test('a person nationality alone does not route an event into a priority region', () => {
  assert.equal(regionMatchesText('Middle East', 'FBI arrests Saudi engineer in San Francisco'), false)
  assert.equal(regionMatchesText('Middle East', 'FBI arrests Saudi OpenAI engineer in San Francisco'), false)
  assert.equal(regionMatchesText('Syria', 'Syrian sailors missing after Black Sea strike off Bulgaria'), false)
  assert.equal(regionMatchesText('Middle East', 'Saudi Arabia investigates a recording device found in Riyadh'), true)
})

test('targeted trafficking of a priority population is central rather than a passing nationality mention', () => {
  assert.equal(regionMatchesText('Bangladesh', '20 out of 30 Bangladeshis trafficked into Russia war were killed'), true)
  assert.equal(regionMatchesText('Bangladesh', 'Bangladeshi engineer wins award in London'), false)
})

test('routine disruption is not major news merely because it is concrete', () => {
  assert.equal(majorEligible('Qantas flight grounded after bedbug outbreak'), false)
  assert.equal(majorEligible('Hackers force supermarket refrigerators to heat up'), false)
  assert.equal(majorEligible('Court overturns national environmental law'), true)
  assert.equal(majorEligible('Two commercial ships sink near the Strait of Hormuz'), true)
  assert.equal(majorEligible('Bangladeshi jobseekers trafficked into Russia war'), true)
  assert.equal(majorEligible('Public employees strike shuts schools and disrupts hospitals'), true)
})

test('hypothetical analysis does not qualify as major news without a reported action', () => {
  assert.equal(majorEligible("Inside leaders' dilemma: strike before elections or wait"), false)
  assert.equal(majorEligible("Iran's next war could be wider as defenses change"), false)
  assert.equal(majorEligible('NATO commander unveils strategy to counter a potential invasion'), true)
})

test('multiple Exa scans merge without duplicating one URL and preserve total cost', () => {
  const shared = { title: 'Shared event', url: 'https://example.org/shared', lanes: ['world-major'], priorityRegions: [], queryIds: ['major'], bestPosition: 1 }
  const report = mergeDiscoveryCandidates([
    { candidates: [shared], queryCount: 12, costDollars: 0.084, rawResultCount: 120 },
    { candidates: [{ ...shared, lanes: ['world-interesting'], queryIds: ['depth'] }], queryCount: 22, costDollars: 0.154, rawResultCount: 220 },
  ], { candidates: [], counts: { freshArticles: 0 } })
  assert.equal(report.uniqueCandidateCount, 1)
  assert.equal(report.queryCount, 34)
  assert.equal(report.costDollars, 0.238)
  assert.deepEqual(report.candidates[0].lanes, ['world-major', 'world-interesting'])
})
