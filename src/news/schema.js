export const NEWS_SCHEMA_VERSION = 1
export const NEWS_DATASET_SCHEMA = 'doomscroller.news-dataset'
export const NEWS_BETA_DATASET_SCHEMA = 'doomscroller.news-beta-dataset'
export const NEWS_BETA_SCHEMA_VERSION = 1

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

function validateNewsSource(value) {
  if (!value || typeof value !== 'object') return null
  const name = cleanText(value.name, 120)
  const url = safeUrl(value.url)
  if (!name || !url) return null
  return {
    name,
    url,
    role: value.role === 'primary' ? 'primary' : 'additional',
    publishedAt: isoDate(value.publishedAt),
    updatedAt: isoDate(value.updatedAt),
  }
}

export function validateNewsBetaCard(value) {
  if (!value || typeof value !== 'object') return null
  const eventId = cleanText(value.event_id || value.eventId || value.id, 160)
  const headline = cleanText(value.headline || value.title, 260)
  const pages = Array.isArray(value.pages)
    ? value.pages.map(page => ({ text: cleanText(page?.text, 5000) })).filter(page => page.text).slice(0, 3)
    : []
  const sources = Array.isArray(value.sources) ? value.sources.map(validateNewsSource).filter(Boolean) : []
  const primary = sources.find(source => source.role === 'primary') || sources[0]
  const firstSeen = isoDate(value.first_seen || value.firstSeen)
  const updatedAt = isoDate(value.updated_at || value.updatedAt)
  const generatedAt = isoDate(value.generated_at || value.generatedAt)
  if (!eventId || !ID_PATTERN.test(eventId) || !headline || !pages.length || !primary || !firstSeen || !updatedAt || !generatedAt) return null

  const imageStatus = ['event-specific', 'contextual', 'fallback', 'unresolved'].includes(value.image?.status)
    ? value.image.status
    : 'unresolved'
  return {
    schemaVersion: NEWS_BETA_SCHEMA_VERSION,
    kind: 'event-card',
    id: eventId,
    eventId,
    title: headline,
    headline,
    description: pages[0].text,
    pages,
    uncertainties: cleanTags(value.uncertainties, 12),
    sources,
    sourceId: cleanText(value.source_id, 100) || 'news-beta',
    sourceName: primary.name,
    sourceUrl: primary.url,
    url: primary.url,
    publishedAt: primary.publishedAt || updatedAt,
    retrievedAt: generatedAt,
    sourceUpdatedAt: primary.updatedAt,
    firstSeen,
    updatedAt,
    generatedAt,
    geography: cleanTags(value.geography, 12),
    regions: cleanTags(value.geography, 12),
    topics: cleanTags(value.topics, 16),
    evidenceFingerprint: cleanText(value.evidence_fingerprint, 160),
    contentVersion: Math.max(1, Math.floor(Number(value.content_version) || 1)),
    imageUrl: safeUrl(value.image?.url, { image: true }),
    imageAlt: cleanText(value.image?.alt, 240),
    image: {
      url: safeUrl(value.image?.url, { image: true }),
      alt: cleanText(value.image?.alt, 240),
      status: imageStatus,
      sourceUrl: safeUrl(value.image?.source_url),
      attribution: cleanText(value.image?.attribution, 240),
    },
  }
}

export function validateNewsBetaDataset(value) {
  if (!value || typeof value !== 'object') return null
  if (value.schema !== NEWS_BETA_DATASET_SCHEMA || Number(value.schemaVersion) !== NEWS_BETA_SCHEMA_VERSION) return null
  const generatedAt = isoDate(value.generatedAt)
  if (!generatedAt || !Array.isArray(value.cards) || !value.feed || !Array.isArray(value.feed.eventIds)) return null
  const cards = []
  const seen = new Set()
  for (const valueCard of value.cards) {
    const card = validateNewsBetaCard(valueCard)
    if (!card || seen.has(card.id)) continue
    seen.add(card.id)
    cards.push(card)
  }
  const eventIds = [...new Set(value.feed.eventIds.filter(id => typeof id === 'string' && seen.has(id)))]
  if (!eventIds.length) return null
  return {
    schema: NEWS_BETA_DATASET_SCHEMA,
    schemaVersion: NEWS_BETA_SCHEMA_VERSION,
    generatedAt,
    batchId: cleanText(value.batchId, 180),
    feed: { eventIds },
    cards,
    policy: value.policy && typeof value.policy === 'object' ? { ...value.policy } : {},
  }
}

export function validateAnyNewsDataset(value) {
  return validateNewsBetaDataset(value) || validateNewsDataset(value)
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
  const valid = validateAnyNewsDataset(dataset)
  if (!valid) return []
  if (valid.schema === NEWS_BETA_DATASET_SCHEMA) {
    const byId = new Map(valid.cards.map(card => [card.id, card]))
    return valid.feed.eventIds.map(id => byId.get(id)).filter(Boolean)
  }
  const byId = new Map(valid.articles.map(article => [article.id, article]))
  return valid.feed.articleIds.map(id => byId.get(id)).filter(Boolean)
}

