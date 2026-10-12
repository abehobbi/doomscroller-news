import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeDiscoveryCandidates, sourceCandidate } from './merge-discovery-candidates.mjs'

function feedItem(overrides = {}) {
  return {
    event: {
      primary: { title: 'Local story', url: 'https://example.com/story?utm_source=rss', publishedAt: '2026-10-11T10:00:00Z', sourceId: 'local', provenance: { feedId: 'local-feed' } },
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
  const exa = { candidates: [{ title: 'Local story', url: 'https://www.example.com/story', lanes: ['world-interesting'], priorityRegions: [], queryIds: ['open'], bestPosition: 3 }], rawResultCount: 1 }
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

test('known local publishers restore priority geography to open-web discoveries', () => {
  const exa = { candidates: [{ title: 'River erosion forces farmers to harvest early', url: 'https://www.thedailystar.net/news/story', lanes: ['world-interesting'], priorityRegions: [], queryIds: ['world-local'], bestPosition: 2 }], rawResultCount: 1 }
  const report = mergeDiscoveryCandidates(exa, { candidates: [], counts: { freshArticles: 0 } })
  assert.deepEqual(report.candidates[0].priorityRegions, ['Bangladesh'])
  assert.deepEqual(report.candidates[0].lanes, ['world-interesting', 'priority-interesting'])
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
