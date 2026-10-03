import crypto from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { feedItems, normalizeFeedItem } from '../news/normalize.mjs'
import { deduplicateArticles } from '../news/deduplicate.mjs'
import { SOURCES, KNOWN_SOURCE_FAILURES } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/sources.mjs'
import {
  plain, completeSentences, clusterArticles, scoreEvent, prepareEvidence,
  assessEvidence, detectWireOrigin,
} from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false })
const PRIORITY = ['Syria', 'GTA', 'Bangladesh', 'Ghana', 'Middle East', 'Canada']
const LOCAL_FEED_REGIONS = new Map([
  ['sana-en', ['Syria', 'Middle East']], ['north-press-en', ['Syria', 'Middle East']], ['enab-baladi-en', ['Syria', 'Middle East']],
  ['dhaka-tribune', ['Bangladesh']], ['daily-star-bangladesh', ['Bangladesh']], ['daily-star-business', ['Bangladesh']],
  ['myjoyonline', ['Ghana']], ['graphic-ghana', ['Ghana']], ['ghanaweb', ['Ghana']],
  ['toronto-city', ['GTA', 'Canada']], ['cbc-toronto', ['GTA', 'Canada']], ['cbc-canada', ['Canada']],
])

const safeError = error => String(error?.message || error || 'unknown').replace(/https?:\/\/\S+/g, '[url]').slice(0, 240)
const fetchText = async (url, accept, maxBytes = 3_000_000) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: accept, 'User-Agent': 'Doomscroller-News-Beta/1.0' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > maxBytes) throw new Error('response too large')
  return { text, finalUrl: response.url, status: response.status }
}

const meta = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'))
  return match ? plain(match[1]) : null
}

function jsonLdBodies(html) {
  const bodies = []
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = value => {
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') {
          if (typeof value.articleBody === 'string') bodies.push(value.articleBody)
          Object.values(value).forEach(visit)
        }
      }
      visit(JSON.parse(match[1]))
    } catch { /* malformed publisher metadata is ignored */ }
  }
  return bodies
}

function pageBody(html) {
  const structured = jsonLdBodies(html).map(plain).filter(text => text.length > 150)
  if (structured.length) return { text: structured.sort((a, b) => b.length - a.length)[0], method: 'JSON-LD articleBody' }
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => plain(match[1]))
    .filter(text => text.length >= 45 && !/cookie|newsletter|sign up|advertisement|copyright infringement/i.test(text))
  return { text: paragraphs.join(' '), method: 'public HTML paragraphs' }
}

async function discover(source, retrievedAt) {
  try {
    const response = await fetchText(source.feedUrl, 'application/rss+xml, application/atom+xml, application/xml, text/xml')
    const items = feedItems(parser.parse(response.text))
    const articles = items.map(item => normalizeFeedItem(item, {
      ...source, regions: source.coverage, topics: source.coverage,
    }, retrievedAt)).filter(Boolean)
    if (!articles.length) throw new Error('No valid feed items')
    return { status: { id: source.id, name: source.name, status: 'ok', itemCount: articles.length }, articles }
  } catch (error) {
    return { status: { id: source.id, name: source.name, status: 'failed', itemCount: 0, error: safeError(error) }, articles: [] }
  }
}

async function snapshot(article) {
  const source = SOURCES.find(candidate => candidate.id === article.provenance.feedId)
  try {
    const response = await fetchText(article.url, 'text/html,application/xhtml+xml')
    const body = pageBody(response.text)
    const description = meta(response.text, 'og:description') || meta(response.text, 'description') || article.description || ''
    const joined = plain(body.text.length >= 180 ? body.text : description)
    return {
      articleId: article.id, publisherId: article.sourceId, feedId: article.provenance.feedId,
      sourceName: article.sourceName, sourceType: source?.sourceType || 'unknown', url: article.url,
      publishedAt: article.publishedAt, updatedAt: article.sourceUpdatedAt, access: 'ok',
      extractionMethod: body.method, pageTitle: meta(response.text, 'og:title') || article.title,
      feedDescription: article.description, auditText: joined.slice(0, 20_000),
      bodySentenceCount: completeSentences(body.text, { maxChars: 20_000, maxSentences: 80 }).length,
      incompleteTail: Boolean(joined && !/[.!?][”’"']?$/.test(joined)), wireOrigin: detectWireOrigin(joined),
      sourceLimitations: source?.limitations || null, imageUrl: article.imageUrl || meta(response.text, 'og:image'),
      imageAlt: article.imageAlt || meta(response.text, 'og:image:alt'),
    }
  } catch (error) {
    const text = plain(article.description || '')
    return {
      articleId: article.id, publisherId: article.sourceId, feedId: article.provenance.feedId,
      sourceName: article.sourceName, sourceType: source?.sourceType || 'unknown', url: article.url,
      publishedAt: article.publishedAt, updatedAt: article.sourceUpdatedAt, access: 'failed',
      extractionMethod: 'RSS description fallback', pageTitle: article.title, feedDescription: article.description,
      auditText: text, bodySentenceCount: 0, incompleteTail: Boolean(text && !/[.!?][”’"']?$/.test(text)),
      wireOrigin: detectWireOrigin(text), sourceLimitations: source?.limitations || null,
      imageUrl: article.imageUrl || null, imageAlt: article.imageAlt || null, error: safeError(error),
    }
  }
}

async function mapLimit(values, limit, fn) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await fn(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}

function contentType(event) {
  const text = `${event.primary.title} ${event.primary.description || ''}`
  if (/\b(meet|talk|summit|speech|address|statement|diplomat)/i.test(text)) return 'diplomacy-or-speech'
  if (/\b(attack|strike|killed|war|conflict|military)/i.test(text)) return 'conflict'
  if (/\b(culture|archaeolog|education|school|science|research|technology|history|discovery)/i.test(text)) return 'culture-science-education'
  if (/\b(econom|inflation|trade|business|market|bank|infrastructure|power|water|transport)/i.test(text)) return 'economy-or-public-life'
  return 'general'
}

export function classifyPriorityRegions(event) {
  // Publisher location is not event location. A Syrian outlet can report on
  // Washington, and that must not turn a US story into a Syria card.
  const regions = new Set()
  const titles = event.articles.map(article => article.title).join(' ')
  if (/\b(?:syria|syrian|damascus|aleppo|daraa|idlib|homs|latakia)\b/i.test(titles)) { regions.add('Syria'); regions.add('Middle East') }
  if (/\b(?:bangladesh|bangladeshi|dhaka|chattogram|chittagong)\b/i.test(titles)) regions.add('Bangladesh')
  if (/\b(?:ghana|ghanaian|accra|kumasi|mahama)\b/i.test(titles)) regions.add('Ghana')
  if (/\b(?:toronto|mississauga|brampton|markham|vaughan|peel region|york region|durham region|halton region)\b/i.test(titles)) { regions.add('GTA'); regions.add('Canada') }
  else if (/\b(?:canada|canadian|ontario|quebec|alberta|british columbia|ottawa|montreal|vancouver)\b/i.test(titles)) regions.add('Canada')
  if (/\b(?:iran|iranian|iraq|iraqi|israel|israeli|palestin|gaza|west bank|leban|jordan|yemen|houthi|qatar|saudi|uae|emirat|oman|bahrain|kuwait|hormuz|netanyahu)\b/i.test(titles)) regions.add('Middle East')
  return [...regions]
}

export function classifyCardRegions(card) {
  const primarySource = SOURCES.find(source => source.name === card?.sources?.[0]?.name)
  return classifyPriorityRegions({
    primary: { provenance: { feedId: primarySource?.id || null } },
    articles: [{ title: String(card?.headline || '') }],
  })
}

function regionScore(regions) {
  if (regions.includes('Syria')) return 25
  if (regions.includes('GTA')) return 18
  if (regions.some(region => ['Bangladesh', 'Ghana', 'Middle East'].includes(region))) return 15
  if (regions.includes('Canada')) return 8
  return 0
}

export function applyBetaSelectionPolicy(event) {
  const regions = classifyPriorityRegions(event)
  const correctedRegion = regionScore(regions)
  const title = event.primary.title || ''
  let editorialPenalty = 0
  if (/\b(?:football|soccer|basketball|nba|nhl|mlb|nfl|trade for (?:veteran|forward|guard)|match|tournament)\b/i.test(title) && event.scoreParts.importance < 18) editorialPenalty -= 18
  if (/^(?:how|why)\b/i.test(title) && event.scoreParts.importance < 18) editorialPenalty -= 12
  if (/\b(?:tourism invites?|light(?:ing)? display|fellowship|selected for .*fellowship|appointed|appointment|joins? the .*team|award ceremony|announces? partnership)\b/i.test(title) && event.scoreParts.importance < 24) editorialPenalty -= 24
  return {
    ...event, regions,
    score: Number((event.score - event.scoreParts.region + correctedRegion + editorialPenalty).toFixed(2)),
    scoreParts: { ...event.scoreParts, region: correctedRegion, editorialPenalty },
  }
}

export function diversityRerank(candidates, { target = 15, maximum = 18, minimumScore = 38 } = {}) {
  const remaining = candidates.filter(item => item.event.score >= minimumScore).map(item => ({ ...item }))
  const selected = [], regionCounts = new Map(), typeCounts = new Map(), publisherCounts = new Map(), adjustments = []
  while (remaining.length && selected.length < maximum) {
    const ranked = remaining.map(item => {
      const regions = item.event.regions.length ? item.event.regions : ['World']
      const type = contentType(item.event), publisher = item.packet.primaryNarrativeSource.publisher
      const uncovered = regions.some(region => PRIORITY.includes(region) && !regionCounts.get(region)) ? 2 : 0
      const regionPenalty = Math.max(...regions.map(region => Math.max(0, (regionCounts.get(region) || 0) - 1) * 2), 0)
      const typePenalty = Math.max(0, (typeCounts.get(type) || 0) - 1) * 2.5
      const publisherPenalty = Math.max(0, (publisherCounts.get(publisher) || 0) - 1) * 3
      return { item, adjusted: item.event.score + uncovered - regionPenalty - typePenalty - publisherPenalty, delta: uncovered - regionPenalty - typePenalty - publisherPenalty, type, regions, publisher }
    }).sort((a, b) => b.adjusted - a.adjusted || b.item.event.score - a.item.event.score)
    const choice = ranked[0]
    if (selected.length >= target && choice.item.event.score < 60) break
    selected.push(choice.item)
    remaining.splice(remaining.indexOf(choice.item), 1)
    choice.regions.forEach(region => regionCounts.set(region, (regionCounts.get(region) || 0) + 1))
    typeCounts.set(choice.type, (typeCounts.get(choice.type) || 0) + 1)
    publisherCounts.set(choice.publisher, (publisherCounts.get(choice.publisher) || 0) + 1)
    adjustments.push({ eventId: choice.item.event.id, baseScore: choice.item.event.score, adjustment: choice.delta, adjustedScore: choice.adjusted, contentType: choice.type, regions: choice.regions })
  }
  return { selected, adjustments, distribution: { regions: Object.fromEntries(regionCounts), contentTypes: Object.fromEntries(typeCounts), publishers: Object.fromEntries(publisherCounts) } }
}

export async function buildEvidenceBatch({ now = Date.now() } = {}) {
  const retrievedAt = new Date(now).toISOString()
  const discoveries = await Promise.all(SOURCES.map(source => discover(source, retrievedAt)))
  const sourceStatus = discoveries.map(result => result.status)
  const articles = discoveries.flatMap(result => result.articles)
  const fresh = articles.filter(article => {
    const ageHours = (now - Date.parse(article.publishedAt)) / 3_600_000
    return ageHours >= -12 && ageHours <= 96
  })
  const unique = deduplicateArticles(fresh)
  const sourceMap = new Map(SOURCES.map(source => [source.id, source]))
  const events = clusterArticles(unique, sourceMap).map(event => applyBetaSelectionPolicy(scoreEvent(event, now))).sort((a, b) => b.score - a.score)
  const evidencePool = events.slice(0, 55)
  const poolArticles = [...new Map(evidencePool.flatMap(event => event.articles).map(article => [article.id, article])).values()]
  const snapshots = await mapLimit(poolArticles, 5, snapshot)
  const snapshotMap = new Map(snapshots.map(value => [value.articleId, value]))
  const prepared = [], evidenceRejected = []
  for (const event of evidencePool) {
    const evidence = event.articles.map(article => snapshotMap.get(article.id)).filter(Boolean).map(value => prepareEvidence(value))
    const preferred = evidence.find(value => value.articleId === event.primary.id)
    const ranked = [...(preferred ? [preferred] : []), ...evidence.filter(value => value !== preferred).sort((a, b) => (b.access === 'ok') - (a.access === 'ok') || b.evidenceText.length - a.evidenceText.length)]
    const primary = ranked[0]
    if (!primary) { evidenceRejected.push({ eventId: event.id, reason: 'no source snapshot' }); continue }
    const assessment = assessEvidence(primary, ranked)
    if (!assessment.adequate) { evidenceRejected.push({ eventId: event.id, reason: assessment.reasons.join('; ') }); continue }
    const facts = ranked.map(source => ({
      sourceId: source.articleId, publisher: source.sourceName, url: source.url,
      publishedAt: source.publishedAt, updatedAt: source.updatedAt, access: source.access,
      wireOrigin: source.wireOrigin, sourceType: source.sourceType,
      completeFactualPropositions: source.evidenceSentences,
      limitations: [source.sourceLimitations, source.previewOnly ? 'Only a feed/metadata preview was accessible.' : null].filter(Boolean),
    }))
    const timeEvidence = facts[0].completeFactualPropositions.filter(text => /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|\d{4})\b/i.test(text)).slice(0, 3)
    const imageSource = ranked.find(source => source.imageUrl) || primary
    prepared.push({ event, assessment, image: { url: imageSource.imageUrl || null, alt: imageSource.imageAlt || event.primary.title, sourceUrl: imageSource.url, attribution: imageSource.sourceName }, packet: {
      eventId: event.id, primaryNarrativeSource: facts[0], sourcePublicationTime: facts[0].publishedAt,
      sourceUpdateTime: facts[0].updatedAt, eventTimeOrWindow: timeEvidence,
      coreFactualPropositions: facts[0].completeFactualPropositions, secondarySourceAdditions: facts.slice(1),
      provenance: facts.map(source => ({ sourceId: source.sourceId, publisher: source.publisher, url: source.url, wireOrigin: source.wireOrigin, sourceType: source.sourceType })),
      attributionAndUncertainty: [...assessment.warnings, 'Publication time is not assumed to be event time.'],
      geographicClassification: event.regions, selectionRationale: null,
      sourceAccessLimitations: facts.flatMap(source => source.limitations),
      curatorInstructions: ['Use only the complete source propositions above.', 'Preserve attribution, negation, dates, numeric units and scope.', 'Do not infer motives, causation, independent confirmation or missing sentence endings.'],
    } })
  }
  prepared.sort((a, b) => b.event.score - a.event.score)
  const reranked = diversityRerank(prepared)
  return {
    retrievedAt, sourceStatus, knownSourceFailures: KNOWN_SOURCE_FAILURES,
    selected: reranked.selected, reranker: { adjustments: reranked.adjustments, distribution: reranked.distribution },
    evidenceRejected,
    counts: { discoveredArticles: articles.length, freshArticles: fresh.length, uniqueArticles: unique.length, eventCandidates: events.length, evidencePoolArticles: poolArticles.length, preparedEvents: prepared.length, selectedEvents: reranked.selected.length, evidenceFailures: evidenceRejected.length, sourceFailures: sourceStatus.filter(source => source.status === 'failed').length },
  }
}

export function evidenceFingerprint(packet) {
  const stable = packet.provenance.map(source => `${source.sourceId}|${source.url}`).sort().join('\n')
    + '\n' + packet.coreFactualPropositions.join('\n')
    + '\n' + packet.secondarySourceAdditions.flatMap(source => source.completeFactualPropositions).join('\n')
  return crypto.createHash('sha256').update(stable).digest('hex')
}
