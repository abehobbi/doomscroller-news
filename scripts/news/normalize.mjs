import { createHash } from 'node:crypto'
import { validateNewsArticle } from '../../src/news/schema.js'

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|cmpid|ocid|at_campaign|at_medium)$/i

const entities = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
}

function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, key) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return entities[key.toLowerCase()] ?? match
  })
}

export function plainText(value, maxLength = 700) {
  const input = typeof value === 'object' && value !== null ? value['#text'] : value
  return decodeEntities(String(input || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.protocol = 'https:'
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.href
  } catch {
    return null
  }
}

function array(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}

function text(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''
  return String(value['#text'] || value._ || value.href || value['@_href'] || '')
}

function first(...values) {
  for (const value of values) {
    const resolved = text(value).trim()
    if (resolved) return resolved
  }
  return ''
}

function linkFrom(item) {
  const links = array(item.link)
  const alternate = links.find(link => typeof link === 'object' && (!link['@_rel'] || link['@_rel'] === 'alternate'))
  return first(alternate, links[0])
}

function imageFrom(item) {
  const media = [
    ...array(item['media:content']),
    ...array(item['media:thumbnail']),
    ...array(item.enclosure),
  ]
  for (const candidate of media) {
    const type = String(candidate?.['@_type'] || '')
    const url = candidate?.['@_url'] || candidate?.url
    if (url && (!type || type.startsWith('image/'))) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:') return parsed.href
      } catch {}
    }
  }
  const html = first(item.description, item.summary, item['content:encoded'], item.content)
  const match = html.match(/<img[^>]+src=["'](https:[^"']+)["']/i)
  return match?.[1] || null
}

function categoriesFrom(item) {
  return array(item.category)
    .map(category => first(category?.['@_term'], category))
    .map(value => plainText(value, 60))
    .filter(Boolean)
}

function iso(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function normalizeFeedItem(item, source, retrievedAt) {
  const title = plainText(item.title, 260)
  const url = canonicalizeUrl(linkFrom(item))
  const publishedAt = iso(first(item.pubDate, item.published, item.date, item['dc:date'], item.updated))
  if (!title || !url || !publishedAt) return null

  const sourceItemId = first(item.guid, item.id, item['dc:identifier'])
  const stableInput = sourceItemId || url
  const id = `news:${source.publisherId}:${createHash('sha256').update(stableInput).digest('hex').slice(0, 24)}`
  const description = plainText(first(item.description, item.summary, item['content:encoded'], item.content), 700)
  const itemTopics = categoriesFrom(item)

  return validateNewsArticle({
    id,
    title,
    description: description && description !== title ? description : null,
    sourceId: source.publisherId,
    sourceName: source.name,
    sourceUrl: source.sourceUrl,
    url,
    publishedAt,
    retrievedAt,
    sourceUpdatedAt: iso(first(item.updated, item['atom:updated'])),
    topics: [...new Set([...source.topics, ...itemTopics])],
    regions: source.regions,
    language: source.language,
    imageUrl: imageFrom(item),
    imageAlt: null,
    provenance: { feedId: source.id, feedUrl: source.feedUrl, sourceItemId: sourceItemId || null },
  })
}

export function feedItems(parsed) {
  const rssItems = parsed?.rss?.channel?.item ?? parsed?.channel?.item
  if (rssItems) return array(rssItems)
  const atomItems = parsed?.feed?.entry
  return array(atomItems)
}

