import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { XMLParser } from 'fast-xml-parser'
import { NEWS_DATASET_SCHEMA, NEWS_SCHEMA_VERSION, validateNewsDataset } from '../../src/news/schema.js'
import { NEWS_SOURCES } from './sources.mjs'
import { feedItems, normalizeFeedItem } from './normalize.mjs'
import { deduplicateArticles } from './deduplicate.mjs'
import {
  ACTIVE_HOURS, RETENTION_HOURS, MAX_FEED_ARTICLES, MAX_RETAINED_ARTICLES, MAX_PER_PUBLISHER, applyFreshness,
} from './freshness.mjs'

const OUTPUT = path.resolve('public/news/feed.json')
const REQUEST_TIMEOUT_MS = 15_000
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false })

async function existingDataset() {
  try {
    return validateNewsDataset(JSON.parse(await fs.readFile(OUTPUT, 'utf8')))
  } catch {
    return null
  }
}

async function fetchSource(source, retrievedAt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(source.feedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': 'Doomscroller-News/1.0 (personal RSS reader)',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const items = feedItems(parser.parse(await response.text()))
    const articles = items.map(item => normalizeFeedItem(item, source, retrievedAt)).filter(Boolean)
    if (!articles.length) throw new Error('No valid articles in feed')
    return {
      articles,
      status: { id: source.id, name: source.name, url: source.sourceUrl, status: 'ok', retrievedAt, itemCount: articles.length, error: null },
    }
  } finally {
    clearTimeout(timer)
  }
}

function safeError(error) {
  if (error?.name === 'AbortError') return 'Request timed out'
  return String(error?.message || error || 'Unknown source failure').replace(/https?:\/\/\S+/g, '[url]').slice(0, 240)
}

async function main() {
  const retrievedAt = new Date().toISOString()
  const previous = await existingDataset()
  const settled = await Promise.allSettled(NEWS_SOURCES.map(source => fetchSource(source, retrievedAt)))
  const fetchedArticles = []
  const sources = []

  settled.forEach((result, index) => {
    const source = NEWS_SOURCES[index]
    if (result.status === 'fulfilled') {
      fetchedArticles.push(...result.value.articles)
      sources.push(result.value.status)
    } else {
      sources.push({
        id: source.id, name: source.name, url: source.sourceUrl, status: 'failed', retrievedAt,
        itemCount: 0, error: safeError(result.reason),
      })
    }
  })

  if (!fetchedArticles.length) {
    throw new Error('Every news source failed; preserving the existing dataset')
  }

  const merged = [...fetchedArticles, ...(previous?.articles || [])]
  const deduplicated = deduplicateArticles(merged)
  const { retained, activeArticleIds } = applyFreshness(deduplicated, new Date(retrievedAt))
  if (!activeArticleIds.length) throw new Error('Collection produced no current stories; preserving the existing dataset')

  const dataset = {
    schema: NEWS_DATASET_SCHEMA,
    schemaVersion: NEWS_SCHEMA_VERSION,
    generatedAt: retrievedAt,
    feed: { articleIds: activeArticleIds },
    articles: retained,
    sources,
    policy: {
      ordering: 'publishedAt-desc',
      activeHours: ACTIVE_HOURS,
      retentionHours: RETENTION_HOURS,
      maxFeedArticles: MAX_FEED_ARTICLES,
      maxRetainedArticles: MAX_RETAINED_ARTICLES,
      maxPerPublisher: MAX_PER_PUBLISHER,
      deduplication: ['stable-id', 'canonical-url', 'normalized-headline'],
    },
  }

  const valid = validateNewsDataset(dataset)
  if (!valid || valid.feed.articleIds.length !== dataset.feed.articleIds.length) {
    throw new Error('Generated news dataset failed final validation')
  }

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true })
  await fs.writeFile(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')

  const ok = sources.filter(source => source.status === 'ok').length
  const failed = sources.length - ok
  console.log(`News updated: ${activeArticleIds.length} active, ${retained.length} retained, ${ok} sources ok, ${failed} failed.`)
  for (const source of sources.filter(item => item.status === 'failed')) console.warn(`Source failed: ${source.id}: ${source.error}`)
}

main().catch(error => {
  console.error(`News update failed: ${safeError(error)}`)
  process.exitCode = 1
})

