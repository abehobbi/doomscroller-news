import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeUrl } from './normalize.mjs'
import { deduplicateArticles, headlineFingerprint } from './deduplicate.mjs'
import { applyFreshness } from './freshness.mjs'
import { NEWS_DATASET_SCHEMA, validateNewsDataset } from '../../src/news/schema.js'
import { NEWS_ENABLED, releaseCategories, savedQueueContainsPausedNews } from '../../src/news/config.js'

const base = {
  schemaVersion: 1, kind: 'article', id: 'news:test:123456', title: 'A real headline',
  description: null, sourceId: 'test', sourceName: 'Test News', sourceUrl: 'https://example.com/',
  url: 'https://example.com/story', publishedAt: '2026-09-10T12:00:00.000Z', retrievedAt: '2026-09-10T13:00:00.000Z',
  sourceUpdatedAt: null, topics: ['World'], regions: ['World'], language: 'en', imageUrl: null, imageAlt: null,
  provenance: { feedId: 'test-feed', feedUrl: 'https://example.com/rss', sourceItemId: '1' },
}

test('canonical URLs discard fragments and tracking parameters', () => {
  assert.equal(canonicalizeUrl('http://www.Example.com/story/?utm_source=x&b=2#a'), 'https://example.com/story?b=2')
})

test('headline fingerprint ignores punctuation and publisher suffix', () => {
  assert.equal(headlineFingerprint('Hello, World — BBC News'), 'hello world')
})

test('deduplication catches URL and effectively identical headline duplicates', () => {
  const copies = [
    base,
    { ...base, id: 'news:test:abcdef', url: 'https://example.com/story?utm_medium=rss' },
    { ...base, id: 'news:other:abcdef', sourceId: 'other', title: 'A REAL headline!' },
  ]
  assert.equal(deduplicateArticles(copies).length, 1)
})

test('freshness keeps a recent archive while feeding only current stories', () => {
  const recent = base
  const archived = { ...base, id: 'news:test:archived', url: 'https://example.com/old', publishedAt: '2026-09-04T12:00:00.000Z' }
  const stale = { ...base, id: 'news:test:stale1', url: 'https://example.com/stale', publishedAt: '2026-08-01T12:00:00.000Z' }
  const result = applyFreshness([recent, archived, stale], new Date('2026-09-10T14:00:00.000Z'))
  assert.deepEqual(result.activeArticleIds, [recent.id])
  assert.deepEqual(result.retained.map(article => article.id), [recent.id, archived.id])
})

test('dataset validation rejects malformed items without rejecting good ones', () => {
  const dataset = validateNewsDataset({
    schema: NEWS_DATASET_SCHEMA, schemaVersion: 1, generatedAt: '2026-09-10T13:00:00Z',
    feed: { articleIds: [base.id, 'bad'] }, articles: [base, { id: 'bad' }], sources: [], policy: {},
  })
  assert.equal(dataset.articles.length, 1)
  assert.deepEqual(dataset.feed.articleIds, [base.id])
})

test('the v1.0 release gate removes News and rejects a persisted News queue', () => {
  assert.equal(typeof NEWS_ENABLED, 'boolean')
  assert.deepEqual(releaseCategories(['news'], false), ['definitions'])
  assert.deepEqual(releaseCategories(['definitions', 'news', 'piano'], false), ['definitions', 'piano'])
  assert.equal(savedQueueContainsPausedNews([{ type: 'definition' }, { type: 'news' }], false), true)
  assert.equal(savedQueueContainsPausedNews([{ type: 'definition' }], false), false)
  assert.deepEqual(releaseCategories(['news'], true), ['news'])
  assert.equal(savedQueueContainsPausedNews([{ type: 'news' }], true), false)
})
