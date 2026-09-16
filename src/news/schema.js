export const NEWS_SCHEMA_VERSION = 1
export const NEWS_DATASET_SCHEMA = 'doomscroller.news-dataset'

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{5,159}$/i
const SPACE = /\s+/g

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.replace(SPACE, ' ').trim()
  return text ? text.slice(0, maxLength) : null
}

function isoDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function safeUrl(value, { image = false } = {}) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (image ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) return null
    url.username = ''
    url.password = ''
    return url.href
  } catch {
    return null
  }
}

function cleanTags(value, max = 16) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(tag => cleanText(tag, 60)).filter(Boolean))].slice(0, max)
}

export function validateNewsArticle(value) {
  if (!value || typeof value !== 'object') return null

  const id = cleanText(value.id, 160)
  const title = cleanText(value.title, 260)
  const sourceId = cleanText(value.sourceId, 100)
  const sourceName = cleanText(value.sourceName, 100)
  const url = safeUrl(value.url)
  const publishedAt = isoDate(value.publishedAt)
  const retrievedAt = isoDate(value.retrievedAt)

  if (!id || !ID_PATTERN.test(id) || !title || title.length < 5 || !sourceId || !sourceName || !url || !publishedAt || !retrievedAt) {
    return null
  }

  const article = {
    schemaVersion: NEWS_SCHEMA_VERSION,
    kind: 'article',
    id,
    title,
    description: cleanText(value.description, 700),
    sourceId,
    sourceName,
    sourceUrl: safeUrl(value.sourceUrl),
    url,
    publishedAt,
    retrievedAt,
    sourceUpdatedAt: isoDate(value.sourceUpdatedAt),
    topics: cleanTags(value.topics),
    regions: cleanTags(value.regions, 12),
    language: cleanText(value.language, 20) || 'en',
    imageUrl: safeUrl(value.imageUrl, { image: true }),
    imageAlt: cleanText(value.imageAlt, 240),
    provenance: {
      feedId: cleanText(value.provenance?.feedId, 100),
      feedUrl: safeUrl(value.provenance?.feedUrl),
      sourceItemId: cleanText(value.provenance?.sourceItemId, 500),
    },
  }

  // Reserved extension points stay namespaced and optional. Stage 1 does not
  // invent event, summary, verification, ranking, or personalization values.
  for (const key of ['eventId', 'summary', 'verification', 'scores', 'developingState']) {
    if (value[key] !== undefined && value[key] !== null) article[key] = value[key]
  }

  return article
}

function validateSourceStatus(value) {
  if (!value || typeof value !== 'object') return null
  const id = cleanText(value.id, 100)
  const name = cleanText(value.name, 100)
  if (!id || !name) return null
  return {
    id,
    name,
    url: safeUrl(value.url),
    status: value.status === 'failed' ? 'failed' : 'ok',
    retrievedAt: isoDate(value.retrievedAt),
    itemCount: Math.max(0, Math.floor(Number(value.itemCount) || 0)),
    error: value.status === 'failed' ? cleanText(value.error, 240) : null,
  }
}

export function validateNewsDataset(value) {
  if (!value || typeof value !== 'object') return null
  if (value.schema !== NEWS_DATASET_SCHEMA || Number(value.schemaVersion) !== NEWS_SCHEMA_VERSION) return null

  const generatedAt = isoDate(value.generatedAt)
  if (!generatedAt || !Array.isArray(value.articles) || !value.feed || !Array.isArray(value.feed.articleIds)) return null

  const articles = []
  const seen = new Set()
  for (const candidate of value.articles) {
    const article = validateNewsArticle(candidate)
    if (!article || seen.has(article.id)) continue
    seen.add(article.id)
    articles.push(article)
  }

  const articleIds = [...new Set(value.feed.articleIds.filter(id => typeof id === 'string' && seen.has(id)))]
  return {
    schema: NEWS_DATASET_SCHEMA,
    schemaVersion: NEWS_SCHEMA_VERSION,
    generatedAt,
    feed: { articleIds },
    articles,
    sources: Array.isArray(value.sources) ? value.sources.map(validateSourceStatus).filter(Boolean) : [],
    policy: value.policy && typeof value.policy === 'object' ? { ...value.policy } : {},
  }
}

export function articlesForFeed(dataset) {
  const valid = validateNewsDataset(dataset)
  if (!valid) return []
  const byId = new Map(valid.articles.map(article => [article.id, article]))
  return valid.feed.articleIds.map(id => byId.get(id)).filter(Boolean)
}

