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
  ['dhaka-tribune', ['Bangladesh']], ['bd24live-en', ['Bangladesh']], ['prothom-alo-en', ['Bangladesh']],
  ['myjoyonline', ['Ghana']], ['graphic-ghana', ['Ghana']], ['ghanaweb', ['Ghana']],
  ['toronto-city', ['GTA', 'Canada']], ['cbc-toronto', ['GTA', 'Canada']], ['cbc-canada', ['Canada']],
])
const FOREIGN_STORY_CUE = /\b(?:syria|syrian|bangladesh|bangladeshi|ghana|ghanaian|canada|canadian|iran|iranian|iraq|iraqi|israel|israeli|palestin|gaza|lebanon|lebanese|jordan|yemen|houthi|qatar|saudi|uae|emirat|dubai|oman|omani|bahrain|kuwait|afghanistan|albania|algeria|angola|argentina|australia|austria|belarus|belgium|bolivia|bosnia|botswana|brazil|bulgaria|burkina faso|burundi|cambodia|cameroon|chad|chile|china|chinese|colombia|congo|croatia|cyprus|czech|denmark|djibouti|ecuador|egypt|eritrea|estonia|eswatini|finland|france|french|gabon|gambia|georgia|germany|german|greece|guatemala|guinea|haiti|honduras|hungary|iceland|india|indian|indonesia|ireland|italy|italian|ivory coast|japan|japanese|kazakhstan|kenya|kosovo|kyrgyzstan|laos|latvia|liberia|libya|lithuania|madagascar|malawi|malaysia|mali|mauritania|mexico|moldova|mongolia|morocco|mozambique|myanmar|namibia|nepal|netherlands|new zealand|niger|nigeria|north korea|norway|pakistan|panama|peru|philippines|poland|portugal|romania|russia|russian|rwanda|senegal|serbia|sierra leone|singapore|slovakia|slovenia|somalia|south africa|south korea|south sudan|spain|sri lanka|sudan|sweden|switzerland|taiwan|tajikistan|tanzania|thailand|togo|tunisia|turkey|turkish|turkmenistan|uganda|ukraine|ukrainian|united kingdom|britain|british|united states|u\.s\.|american|uruguay|uzbekistan|venezuela|vietnam|zambia|zimbabwe|trump|putin|zelensky|xi jinping|netanyahu)\b/i
const WORLD_COUNTRIES = [
  ['Ethiopia', /\b(?:ethiopia|ethiopian|tigray|amhara)\b/i], ['Zambia', /\b(?:zambia|zambian|lusaka)\b/i],
  ['Lithuania', /\b(?:lithuania|lithuanian|vilnius)\b/i], ['Ukraine', /\b(?:ukraine|ukrainian|kyiv|zelensky)\b/i],
  ['Russia', /\b(?:russia|russian|moscow|putin)\b/i], ['United States', /\b(?:united states|u\.s\.|american|washington|trump)\b/i],
  ['China', /\b(?:china|chinese|beijing|xi jinping)\b/i], ['India', /\b(?:india|indian|new delhi)\b/i],
  ['Pakistan', /\b(?:pakistan|pakistani|islamabad)\b/i], ['Nigeria', /\b(?:nigeria|nigerian|abuja|lagos)\b/i],
  ['South Africa', /\b(?:south africa|south african|johannesburg|cape town)\b/i], ['Kenya', /\b(?:kenya|kenyan|nairobi)\b/i],
  ['Sudan', /\b(?:sudan|sudanese|khartoum|darfur)\b/i], ['Myanmar', /\b(?:myanmar|burma|burmese)\b/i],
  ['Japan', /\b(?:japan|japanese|tokyo)\b/i], ['Brazil', /\b(?:brazil|brazilian|brasilia)\b/i],
  ['Mexico', /\b(?:mexico|mexican|mexico city)\b/i], ['France', /\b(?:france|french|paris)\b/i],
  ['Germany', /\b(?:germany|german|berlin)\b/i], ['United Kingdom', /\b(?:united kingdom|britain|british|london)\b/i],
  ['Denmark', /\b(?:denmark|danish|copenhagen)\b/i], ['World', /$^/],
]
const REGION_MINIMUMS = new Map([['Syria', 2], ['Bangladesh', 2], ['Ghana', 2], ['Middle East', 2], ['Canada', 2], ['GTA', 1]])

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
  for (const article of event.articles) {
    for (const region of article.geography?.priorityRegions || []) regions.add(region)
    const local = LOCAL_FEED_REGIONS.get(article.provenance?.feedId) || []
    // Local headlines often omit their own country. Inherit a local feed's
    // region only when the headline does not plainly point abroad.
    if (local.length && !FOREIGN_STORY_CUE.test(article.title || '')) local.forEach(region => regions.add(region))
  }
  if (/\b(?:syria|syrian|damascus|aleppo|daraa|idlib|homs|latakia)\b/i.test(titles)) { regions.add('Syria'); regions.add('Middle East') }
  if (/\b(?:bangladesh|bangladeshi|dhaka|chattogram|chittagong|sheikh hasina|muhammad yunus|khaleda zia|awami league|bangladesh nationalist party|\bBNP\b)\b/i.test(titles)) regions.add('Bangladesh')
  if (/\b(?:ghana|ghanaian|accra|kumasi|mahama)\b/i.test(titles)) regions.add('Ghana')
  if (/\b(?:toronto|mississauga|brampton|markham|vaughan|peel region|york region|durham region|halton region)\b/i.test(titles)) { regions.add('GTA'); regions.add('Canada') }
  else if (/\b(?:canada|canadian|ontario|quebec|alberta|british columbia|ottawa|montreal|vancouver)\b/i.test(titles)) regions.add('Canada')
  if (/\b(?:iran|iranian|iraq|iraqi|israel|israeli|palestin|gaza|west bank|leban|jordan|yemen|houthi|qatar|saudi|uae|emirat|oman|bahrain|kuwait|hormuz|netanyahu)\b/i.test(titles)) regions.add('Middle East')
  return [...regions]
}

function countryBucket(event) {
  const articles = event.articles?.length ? event.articles : [event.primary]
  const text = articles.map(article => `${article?.title || ''} ${article?.description || ''}`).join(' ')
  const match = WORLD_COUNTRIES.find(([, pattern]) => pattern.test(text))
  return match?.[0] || (event.regions[0] ?? 'World')
}

function editorialSignals(event) {
  const text = event.articles.map(article => `${article.title} ${article.description || ''}`).join(' ')
  const consequenceHits = (text.match(/\b(?:election|referendum|peace agreement|ceasefire|coup|government collapses?|resigns?|constitutional|supreme court|court rules?|parliament (?:passes|approves|rejects)|central bank|interest rates?|inflation|sanction|earthquake|eruption|flood|wildfire|outbreak|epidemic|evacuation|war|invasion|attack|killed|mass arrest|protest|energy crisis|power grid|food security|humanitarian|major reform|treaty)\b/gi) || []).length
  const discoveryHits = (text.match(/\b(?:first[- ]ever|for the first time|discov(?:er|ery)|breakthrough|archaeolog|ancient|new species|extinct|conservation|restored|spacecraft|telescope|researchers? find|scientists? (?:find|discover)|medical advance|record[- ]breaking|unprecedented)\b/gi) || []).length
  return {
    consequence: Math.min(12, consequenceHits * 4),
    discovery: Math.min(10, discoveryHits * 5),
  }
}

export function isEditoriallyEligibleTitle(title) {
  return !/\b(?:tourism invites?|invite[^.]{0,60}(?:falls|light|colour|color).*display|(?:falls|light|lighting|colour|color) display|selected for .*fellowship|fellowship|appointed (?:chief|director|head|ceo)|appointment of (?:a |the )?(?:chief|director|head|ceo)|joins? the .*team|award ceremony|announces? partnership|signs? memorandum|memorandum of understanding|courtesy call|stakeholder engagement|workshop held|anniversary celebration|election signs?)\b/i.test(String(title || ''))
}

export function classifyCardRegions(card) {
  const primarySource = SOURCES.find(source => source.name === card?.sources?.[0]?.name)
  return classifyPriorityRegions({
    primary: { provenance: { feedId: primarySource?.id || null } },
    articles: [{ title: String(card?.headline || ''), provenance: { feedId: primarySource?.id || null } }],
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
  const signals = editorialSignals(event)
  let editorialPenalty = 0
  if (/\b(?:football|soccer|basketball|hockey|nba|nhl|mlb|nfl|trade for (?:veteran|forward|guard)|match|tournament)\b/i.test(title) && event.scoreParts.importance < 24) editorialPenalty -= 18
  if (/^(?:how|why|who)\b/i.test(title) && event.scoreParts.importance < 18) editorialPenalty -= 12
  if (!isEditoriallyEligibleTitle(title)) editorialPenalty -= 30
  const editorialBonus = signals.consequence + signals.discovery
  return {
    ...event, regions,
    score: Number((event.score - event.scoreParts.region + correctedRegion + editorialPenalty + editorialBonus).toFixed(2)),
    scoreParts: { ...event.scoreParts, region: correctedRegion, consequence: signals.consequence, discovery: signals.discovery, editorialBonus, editorialPenalty },
  }
}

export function diversityRerank(candidates, { target = 30, maximum = 30, minimumScore = 38 } = {}) {
  const remaining = candidates.filter(item => item.event.score >= minimumScore).map(item => ({ ...item }))
  const selected = [], regionCounts = new Map(), countryCounts = new Map(), typeCounts = new Map(), publisherCounts = new Map(), adjustments = []
  while (remaining.length && selected.length < maximum) {
    const ranked = remaining.map(item => {
      const regions = item.event.regions.length ? item.event.regions : ['World']
      const type = contentType(item.event), publisher = item.packet.primaryNarrativeSource.publisher, country = countryBucket(item.event)
      const uncovered = Math.max(0, ...regions.map(region => {
        const minimum = REGION_MINIMUMS.get(region) || 0
        return minimum > (regionCounts.get(region) || 0) ? 14 : 0
      }))
      const regionPenalty = Math.max(...regions.map(region => Math.max(0, (regionCounts.get(region) || 0) - 1) * 5), 0)
      const countryPenalty = (countryCounts.get(country) || 0) * 6
      const typePenalty = Math.max(0, (typeCounts.get(type) || 0) - 1) * 2.5
      const publisherPenalty = (publisherCounts.get(publisher) || 0) * 4
      const discoverySignal = Math.max(item.event.scoreParts?.discovery || 0, item.event.scoreParts?.interestingness || 0)
      const worldDiscovery = !regions.some(region => PRIORITY.includes(region)) && discoverySignal > 0 && selected.filter(value => Math.max(value.event.scoreParts?.discovery || 0, value.event.scoreParts?.interestingness || 0) > 0 && !value.event.regions.some(region => PRIORITY.includes(region))).length < 4 ? 7 : 0
      const delta = uncovered + worldDiscovery - regionPenalty - countryPenalty - typePenalty - publisherPenalty
      return { item, adjusted: item.event.score + delta, delta, type, regions, country, publisher }
    }).sort((a, b) => b.adjusted - a.adjusted || b.item.event.score - a.item.event.score)
    const choice = ranked[0]
    if (selected.length >= target && choice.item.event.score < 60) break
    selected.push(choice.item)
    remaining.splice(remaining.indexOf(choice.item), 1)
    choice.regions.forEach(region => regionCounts.set(region, (regionCounts.get(region) || 0) + 1))
    countryCounts.set(choice.country, (countryCounts.get(choice.country) || 0) + 1)
    typeCounts.set(choice.type, (typeCounts.get(choice.type) || 0) + 1)
    publisherCounts.set(choice.publisher, (publisherCounts.get(choice.publisher) || 0) + 1)
    adjustments.push({ eventId: choice.item.event.id, baseScore: choice.item.event.score, adjustment: choice.delta, adjustedScore: choice.adjusted, contentType: choice.type, regions: choice.regions, country: choice.country })
  }
  return { selected, adjustments, distribution: { regions: Object.fromEntries(regionCounts), countries: Object.fromEntries(countryCounts), contentTypes: Object.fromEntries(typeCounts), publishers: Object.fromEntries(publisherCounts) } }
}

export function selectActiveFeedCards(cards, { maximum = 20, now = Date.now() } = {}) {
  const sorted = cards.filter(card => isEditoriallyEligibleTitle(card.headline))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  const recent = sorted.filter(card => now - Date.parse(card.updated_at) <= 7 * 86_400_000)
  const pool = recent.length >= maximum ? recent : sorted
  const selected = [], used = new Set(), counts = new Map()
  const add = card => {
    if (!card || used.has(card.event_id) || selected.length >= maximum) return false
    selected.push(card); used.add(card.event_id)
    for (const region of card.geography || []) counts.set(region, (counts.get(region) || 0) + 1)
    return true
  }
  for (const [region, minimum] of REGION_MINIMUMS) {
    for (const card of pool) {
      if ((counts.get(region) || 0) >= minimum) break
      if ((card.geography || []).includes(region)) add(card)
    }
  }
  while (selected.length < maximum) {
    const choices = pool.filter(card => !used.has(card.event_id)).map(card => {
      const regions = card.geography?.length ? card.geography : ['World']
      const repetition = Math.max(...regions.map(region => counts.get(region) || 0))
      const ageHours = Math.max(0, (now - Date.parse(card.updated_at)) / 3_600_000)
      return { card, score: 20 - ageHours / 12 - repetition * 4 }
    }).sort((a, b) => b.score - a.score || Date.parse(b.card.updated_at) - Date.parse(a.card.updated_at))
    if (!choices.length) break
    add(choices[0].card)
  }
  return selected
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
  const evidencePool = events.slice(0, 80)
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
