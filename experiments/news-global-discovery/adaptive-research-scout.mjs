import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStrict } from '../../artifacts/summary-feasibility/round-9/strict-json.mjs'
import { buildTavilyDiscoveryReport } from './tavily-complementary-scout.mjs'

export const MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const ROUND_SIZES = Object.freeze([3, 3, 2])
export const TAVILY_CREDITS_PER_SEARCH = 2
export const FIXED_RECALL_QUERIES = Object.freeze([
  {
    id: 'fixed-wire-accountability', lane: 'world-major', region: null,
    blind_spot: 'original wire investigations and consequential public-interest reporting',
    query: 'consequential investigation court ruling outbreak central bank labour public impact',
    rationale: 'Recover high-value Reuters and AP reporting when publisher feeds are unavailable',
    includeDomains: ['reuters.com', 'apnews.com'],
  },
  {
    id: 'fixed-bangladesh-ghana-local', lane: 'priority-interesting', region: null,
    blind_spot: 'Bangladesh and Ghana local accountability labour and public services',
    query: 'Bangladesh Ghana accountability labour public services livelihoods environment local consequences',
    rationale: 'Guarantee a sweep of strong priority-region publishers for concrete local reporting',
    includeDomains: ['thedailystar.net', 'en.prothomalo.com', 'tbsnews.net', 'bdnews24.com', 'citinewsroom.com', 'graphic.com.gh', 'myjoyonline.com'],
  },
  {
    id: 'fixed-syria-middle-east-canada-local', lane: 'priority-interesting', region: null,
    blind_spot: 'Syria Middle East and Canada local accountability and human consequences',
    query: 'Syria Middle East Canada accountability public services livelihoods local consequences',
    rationale: 'Guarantee a second priority-region sweep beyond dominant conflict and national headlines',
    includeDomains: ['sana.sy', 'english.enabbaladi.net', 'syriadirect.org', 'aljazeera.com', 'cbc.ca', 'globalnews.ca', 'toronto.citynews.ca'],
  },
])
export const MAX_TAVILY_CREDITS = (ROUND_SIZES.reduce((sum, count) => sum + count, 0) + FIXED_RECALL_QUERIES.length) * TAVILY_CREDITS_PER_SEARCH
export const ALLOWED_LANES = new Set(['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery'])
export const ROUND_LANE_SHAPES = Object.freeze([
  ['priority-interesting', 'priority-major', 'world-major'],
  ['priority-interesting', 'priority-major', 'discovery'],
  ['priority-interesting', 'world-interesting'],
])
const PRIORITY_REGIONS = ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']
const REGION_QUERY_NAMES = Object.freeze({ 'Middle East': 'Middle East', GTA: 'Greater Toronto', Syria: 'Syria', Bangladesh: 'Bangladesh', Ghana: 'Ghana', Canada: 'Canada' })
const REGION_TERMS = Object.freeze({
  Syria: ['syria', 'syrian'],
  'Middle East': ['middle east', 'syria', 'syrian', 'lebanon', 'lebanese', 'jordan', 'jordanian', 'palestine', 'palestinian', 'israel', 'israeli', 'iraq', 'iraqi', 'yemen', 'yemeni', 'oman', 'omani', 'qatar', 'qatari', 'bahrain', 'kuwait', 'saudi', 'emirati', 'uae'],
  Bangladesh: ['bangladesh', 'bangladeshi', 'dhaka', 'chattogram', 'chittagong', 'sylhet', 'khulna', 'rajshahi'],
  Ghana: ['ghana', 'ghanaian', 'accra', 'kumasi', 'tamale'],
  Canada: ['canada', 'canadian', 'ontario', 'quebec', 'alberta', 'british columbia', 'manitoba', 'saskatchewan', 'nova scotia', 'new brunswick', 'newfoundland', 'nunavut', 'yukon'],
  GTA: ['greater toronto', 'toronto', 'mississauga', 'brampton', 'markham', 'vaughan', 'richmond hill', 'pickering', 'ajax', 'durham', 'peel', 'york region', 'halton'],
})

const SYSTEM_PROMPT = `You are the adaptive research planner for Doomscroller News. Identify valuable stories the current search pool is likely to have OMITTED, then write precise web-search queries that can find them.

Prioritize distinctive original local reporting from small places and undercovered countries; ordinary life, livelihoods, exploitation, public services, environment, culture, identity, living traditions, crafts, language, heritage, community change, rescues and unusual human stories; Syria, the wider Middle East, Bangladesh, Ghana, Canada and the GTA without padding; and accessible archaeology, history, science, nature, medicine and field discoveries with a concrete new finding.

Avoid dominant headlines already present, speeches, ceremonies, publicity, partnerships, event listings, tourism, sport, celebrity news, opinion and vague explainers. Search different editorial blind spots rather than variations of one idea. Do not invent or presuppose a particular story, village, occupation, discovery or outcome. Priority-region searches should broadly sweep concrete current reporting about accountability, labour, public services, health, environment, livelihoods and local consequences in that region.

The search service already applies the supplied publication window. Write each query as ONE short natural-language search of 6-16 words. Never include dates, Boolean operators such as OR/AND, parentheses, quotation marks, long synonym lists or instructions like "find an article". A priority-region query must name its region. Across the run, priority queries must cover different regions. Follow the required lane shape supplied for the current round exactly.`

function schema(count) {
  return { name: 'doomscroller_adaptive_queries', strict: true, schema: {
    type: 'object', additionalProperties: false, required: ['queries'], properties: { queries: {
      type: 'array', minItems: count, maxItems: count, items: {
        type: 'object', additionalProperties: false, required: ['id', 'lane', 'region', 'blind_spot', 'query', 'rationale'],
        properties: {
          id: { type: 'string', minLength: 4, maxLength: 60 }, lane: { type: 'string', enum: [...ALLOWED_LANES] },
          region: { type: ['string', 'null'], enum: [null, ...PRIORITY_REGIONS] }, blind_spot: { type: 'string', minLength: 8, maxLength: 120 },
          query: { type: 'string', minLength: 20, maxLength: 140 }, rationale: { type: 'string', minLength: 8, maxLength: 180 },
        },
      },
    } },
  } }
}

export function compactDiscoveryContext(reports, { maximumHeadlines = 80 } = {}) {
  const candidates = reports.flatMap(report => report?.candidates || []), laneCounts = {}, regionCounts = {}, publisherCounts = {}
  const publisher = candidate => {
    try { return new URL(candidate?.url).hostname.replace(/^www\./, '') } catch { return 'unknown' }
  }
  for (const candidate of candidates) {
    for (const lane of candidate.lanes || []) laneCounts[lane] = (laneCounts[lane] || 0) + 1
    for (const region of candidate.priorityRegions || []) regionCounts[region] = (regionCounts[region] || 0) + 1
    const domain = publisher(candidate); publisherCounts[domain] = (publisherCounts[domain] || 0) + 1
  }
  const seen = new Set(), headlines = []
  const add = candidate => {
    const title = String(candidate.title || '').replace(/\s+/g, ' ').trim(), key = title.toLowerCase()
    if (!title || seen.has(key) || headlines.length >= maximumHeadlines) return
    seen.add(key); headlines.push({ title, lanes: candidate.lanes || [], regions: candidate.priorityRegions || [], publisher: publisher(candidate) })
  }
  candidates.slice(0, Math.min(30, maximumHeadlines)).forEach(add)
  const diversityRanked = [...candidates].sort((left, right) => {
    const rarity = candidate => {
      const laneRarity = Math.min(...(candidate.lanes || ['unknown']).map(lane => laneCounts[lane] || candidates.length))
      const regionRarity = (candidate.priorityRegions || []).length ? Math.min(...candidate.priorityRegions.map(region => regionCounts[region] || candidates.length)) : candidates.length
      return laneRarity + regionRarity + (publisherCounts[publisher(candidate)] || candidates.length)
    }
    return rarity(left) - rarity(right) || String(left.title || '').localeCompare(String(right.title || ''))
  })
  diversityRanked.forEach(add)
  return { candidateCount: candidates.length, laneCounts, regionCounts, publisherCounts, headlines }
}

export function auditPlannedQueries(queries, expectedCount, priorQueries = [], round = expectedCount === 2 ? 3 : 1) {
  if (!Array.isArray(queries) || queries.length !== expectedCount) return { valid: false, reason: 'wrong query count' }
  const normalized = queries.map(item => String(item?.query || '').toLowerCase().replace(/\s+/g, ' ').trim())
  if (new Set(normalized).size !== normalized.length) return { valid: false, reason: 'duplicate adaptive query' }
  const prior = new Set(priorQueries.map(value => String(value?.query || value).toLowerCase().replace(/\s+/g, ' ').trim()))
  if (normalized.some(value => prior.has(value))) return { valid: false, reason: 'query repeats an earlier round' }
  if (queries.some(item => !ALLOWED_LANES.has(item?.lane))) return { valid: false, reason: 'disallowed lane' }
  const isPriorityLane = lane => lane === 'priority-interesting' || lane === 'priority-major'
  if (queries.some(item => isPriorityLane(item.lane) && !PRIORITY_REGIONS.includes(item.region))) return { valid: false, reason: 'priority query lacks a supported region' }
  if (queries.some(item => !isPriorityLane(item.lane) && item.region !== null)) return { valid: false, reason: 'non-priority query has a priority region' }
  const words = queries.map(item => String(item.query || '').trim().split(/\s+/).filter(Boolean).length)
  if (words.some(count => count < 6 || count > 16)) return { valid: false, reason: 'query must contain 6-16 words' }
  if (queries.some(item => /\b(?:OR|AND)\b|[()"']|\b20\d{2}\b/.test(String(item.query || '')))) return { valid: false, reason: 'query contains search operators or dates' }
  if (queries.some(item => item.region && !REGION_TERMS[item.region].some(term => String(item.query).toLowerCase().includes(term)))) return { valid: false, reason: 'priority query does not name its region' }
  const expectedLanes = ROUND_LANE_SHAPES[round - 1]
  if (!expectedLanes || expectedLanes.length !== expectedCount || [...expectedLanes].sort().join('|') !== queries.map(item => item.lane).sort().join('|')) return { valid: false, reason: `round ${round} has the wrong lane mix` }
  const priorityRegions = queries.filter(item => isPriorityLane(item.lane)).map(item => item.region)
  const priorRegions = new Set(priorQueries.filter(item => isPriorityLane(item?.lane)).map(item => item.region))
  if (new Set(priorityRegions).size !== priorityRegions.length || priorityRegions.some(region => priorRegions.has(region))) return { valid: false, reason: 'priority searches must cover distinct regions across rounds' }
  return { valid: true, reason: null }
}

export function normalizePlannedQueries(queries) {
  return Array.isArray(queries) ? queries.map(item => {
    const words = String(item?.query || '').trim().split(/\s+/).filter(Boolean).slice(0, 16)
    const padding = ['recent', 'local', 'accountability', 'public', 'impact', 'reporting']
    for (const word of padding) {
      if (words.length >= 6) break
      if (!words.some(existing => existing.toLowerCase() === word)) words.push(word)
    }
    return {
      ...item,
      query: words.join(' '),
      region: item?.lane === 'priority-interesting' || item?.lane === 'priority-major' ? item.region : null,
    }
  }) : queries
}

export function repairRepeatedPriorityRegions(queries, priorQueries = [], regionCounts = {}) {
  const isPriorityLane = lane => lane === 'priority-interesting' || lane === 'priority-major'
  const used = new Set(priorQueries.filter(item => isPriorityLane(item?.lane)).map(item => item.region))
  const available = PRIORITY_REGIONS.filter(region => !used.has(region)).sort((left, right) => Number(regionCounts[left] || 0) - Number(regionCounts[right] || 0) || PRIORITY_REGIONS.indexOf(left) - PRIORITY_REGIONS.indexOf(right))
  return queries.map(item => {
    if (!isPriorityLane(item?.lane)) return item
    if (PRIORITY_REGIONS.includes(item.region) && !used.has(item.region)) { used.add(item.region); return item }
    const region = available.find(candidate => !used.has(candidate))
    if (!region) return item
    used.add(region)
    const queryName = REGION_QUERY_NAMES[region]
    return {
      ...item,
      id: `unused-${region.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      region,
      blind_spot: `undercovered current reporting from ${region}`,
      query: `${queryName} recent accountability public services health labour environment livelihoods local consequences`,
      rationale: `Deterministic fallback preserves distinct priority-region coverage after planner repetition`,
    }
  })
}

export function deterministicFallbackQueries(round, priorQueries = [], regionCounts = {}) {
  const lanes = ROUND_LANE_SHAPES[round - 1] || []
  const usedRegions = new Set(priorQueries.filter(item => item?.region).map(item => item.region))
  const availableRegions = PRIORITY_REGIONS.filter(region => !usedRegions.has(region))
    .sort((a, b) => Number(regionCounts[a] || 0) - Number(regionCounts[b] || 0) || a.localeCompare(b))
  let regionIndex = 0
  const worldQueries = {
    'world-major': 'undercovered global court regulation infrastructure disaster public impact developments',
    'world-interesting': 'undercovered local livelihoods culture environment public services community changes worldwide',
    discovery: 'recent archaeology ecology medicine field research discoveries overlooked worldwide',
  }
  return lanes.map((lane, index) => {
    const priority = lane === 'priority-interesting' || lane === 'priority-major'
    const region = priority ? availableRegions[regionIndex++] : null
    if (priority && !region) throw new Error(`adaptive planner round ${round}: no unused priority region remains for deterministic fallback`)
    const query = priority
      ? `${REGION_QUERY_NAMES[region]} recent accountability public services health labour environment local consequences`
      : worldQueries[lane]
    return {
      id: `fallback-r${round}-${index + 1}`,
      lane,
      region,
      blind_spot: priority ? `undercovered current reporting from ${region}` : `undercovered ${lane} reporting`,
      query,
      rationale: 'Deterministic fallback preserves lane and regional breadth after bounded planner failures',
    }
  })
}

export function resultMatchesRegion(result, region) {
  if (!region) return true
  const haystack = `${result?.title || ''} ${result?.content || ''} ${result?.url || ''}`.toLowerCase()
  return REGION_TERMS[region].some(term => haystack.includes(term))
}

function credentials() {
  if (process.env.FREE_PLAN_CONFIRMED !== 'yes') throw new Error('FREE_PLAN_CONFIRMED=yes is required; no paid fallback exists')
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN || !process.env.TAVILY_API_KEY) throw new Error('Adaptive scout credentials are missing')
  return { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, tavilyKey: process.env.TAVILY_API_KEY }
}

function exposedResponse(body) { return body?.result?.response ?? body?.result?.choices?.[0]?.message?.content ?? null }

export async function planQueries({ context, priorSearches = [], count, round, fetchImpl = fetch }) {
  const { accountId, token } = credentials()
  const expectedShape = ROUND_LANE_SHAPES[round - 1].join(', ')
  let priorFailure = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const request = { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ round, requested_query_count: count, required_lane_shape: expectedShape, validation_retry: priorFailure, date_window: context.requestedWindow, current_pool: context.pool, prior_adaptive_results: priorSearches }) }],
      temperature: 0.25, max_completion_tokens: 1200, response_format: { type: 'json_schema', json_schema: schema(count) }, chat_template_kwargs: { enable_thinking: false }, store: false }
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(110_000) })
    const raw = await response.text()
    let body = null
    try { body = parseStrict(raw) } catch {}
    if (!response.ok || body?.success === false) {
      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < 3) { priorFailure = `temporary provider HTTP ${response.status}`; continue }
      if (retryable) {
        const queries = deterministicFallbackQueries(round, priorSearches, context?.pool?.regionCounts)
        return { queries, usage: null, returnedModel: null, attempts: attempt, deterministicFallback: `temporary provider HTTP ${response.status}` }
      }
      throw new Error(`adaptive planner round ${round}: HTTP ${response.status}`)
    }
    const exposed = exposedResponse(body)
    let parsed
    try { parsed = typeof exposed === 'string' ? parseStrict(exposed) : exposed }
    catch { priorFailure = 'response was not valid JSON'; continue }
    const queries = normalizePlannedQueries(parsed?.queries)
    const audit = auditPlannedQueries(queries, count, priorSearches, round)
    if (audit.valid) return { queries, usage: body?.result?.usage ?? body?.usage ?? null, returnedModel: body?.result?.model ?? null, attempts: attempt }
    if (attempt === 3 && audit.reason === 'priority searches must cover distinct regions across rounds') {
      const repaired = repairRepeatedPriorityRegions(queries, priorSearches, context?.pool?.regionCounts)
      const repairedAudit = auditPlannedQueries(repaired, count, priorSearches, round)
      if (repairedAudit.valid) return { queries: repaired, usage: body?.result?.usage ?? body?.usage ?? null, returnedModel: body?.result?.model ?? null, attempts: attempt, deterministicRepair: audit.reason }
    }
    if (attempt === 3) {
      const fallback = deterministicFallbackQueries(round, priorSearches, context?.pool?.regionCounts)
      const fallbackAudit = auditPlannedQueries(fallback, count, priorSearches, round)
      if (fallbackAudit.valid) return { queries: fallback, usage: body?.result?.usage ?? body?.usage ?? null, returnedModel: body?.result?.model ?? null, attempts: attempt, deterministicFallback: audit.reason }
    }
    priorFailure = audit.reason
  }
  throw new Error(`adaptive planner round ${round}: ${priorFailure}`)
}

export async function searchTavily(definition, window, apiKey, fetchImpl = fetch) {
  const request = { query: definition.query, search_depth: 'advanced', max_results: 20, topic: 'news', start_date: window.start.slice(0, 10), end_date: window.end.slice(0, 10), include_published_date: true, filter_by_published_date: true, include_answer: false, include_raw_content: false, include_images: false, include_usage: true, safe_search: true }
  if (definition.includeDomains?.length) request.include_domains = definition.includeDomains
  const response = await fetchImpl('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  const raw = await response.text(), payload = parseStrict(raw)
  if (!response.ok) throw new Error(`${definition.id}: HTTP ${response.status}`)
  const rawResults = payload?.results || [], results = rawResults.filter(result => resultMatchesRegion(result, definition.region))
  return { ...definition, role: 'adaptive-recall', requestId: payload?.request_id || null, creditsUsed: Number(payload?.usage?.credits || 1), rawResultCount: rawResults.length, regionRejectedCount: rawResults.length - results.length, results }
}

export function compactRoundResults(searches) {
  return searches.map(search => ({ query: search.query, lane: search.lane, region: search.region, blind_spot: search.blind_spot, results: (search.results || []).slice(0, 12).map(item => ({ title: item.title, url: item.url, published_at: item.published_date || null })) }))
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }

async function main() {
  const args = process.argv.slice(2), values = flag => { const found = []; for (let i = 0; i < args.length; i += 1) if (args[i] === flag) found.push(args[++i]); return found }
  const inputs = values('--input'), output = values('--output')[0], scan = values('--scan')[0] || 'full'
  const hours = Number(values('--hours')[0] || 72)
  if (!inputs.length || !output) throw new Error('at least one --input and --output are required')
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('--hours must be from 1 to 168')
  if (args.includes('--dry-run')) { process.stdout.write(`${JSON.stringify({ rounds: ROUND_SIZES, maximumTavilyCredits: MAX_TAVILY_CREDITS }, null, 2)}\n`); return }
  const end = new Date(), start = new Date(end.getTime() - hours * 3_600_000), window = { start: start.toISOString(), end: end.toISOString() }
  if (scan === 'major') {
    const report = buildTavilyDiscoveryReport([], window); report.mode = 'adaptive-research-skipped-for-major-scan'; report.planner = { model: MODEL, calls: [], totalNeurons: 0 }
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ skipped: true, reason: 'major-scan' }, null, 2)}\n`); return
  }
  const { tavilyKey } = credentials(), reports = await Promise.all(inputs.map(readJson))
  const pool = compactDiscoveryContext(reports), searches = [], plannerCalls = []
  for (let index = 0; index < ROUND_SIZES.length; index += 1) {
    const count = ROUND_SIZES[index], prior = compactRoundResults(searches)
    const plan = await planQueries({ context: { requestedWindow: window, pool }, priorSearches: prior, count, round: index + 1 })
    plannerCalls.push({ round: index + 1, queryCount: count, usage: plan.usage, returnedModel: plan.returnedModel, queries: plan.queries })
    for (const item of plan.queries) {
      if (searches.reduce((sum, value) => sum + value.creditsUsed, 0) + TAVILY_CREDITS_PER_SEARCH > MAX_TAVILY_CREDITS) throw new Error('Adaptive discovery stopped before exceeding its Tavily credit ceiling')
      searches.push(await searchTavily({ ...item, id: `adaptive-r${index + 1}-${item.id}` }, window, tavilyKey))
    }
  }
  for (const item of FIXED_RECALL_QUERIES) {
    if (searches.reduce((sum, value) => sum + value.creditsUsed, 0) + TAVILY_CREDITS_PER_SEARCH > MAX_TAVILY_CREDITS) throw new Error('Adaptive discovery stopped before exceeding its Tavily credit ceiling')
    searches.push(await searchTavily(item, window, tavilyKey))
  }
  const report = buildTavilyDiscoveryReport(searches, window)
  report.mode = 'adaptive-research'; report.planner = { model: MODEL, calls: plannerCalls, totalNeurons: plannerCalls.reduce((sum, call) => sum + Number(call.usage?.neurons || 0), 0) }
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ queries: report.queryCount, creditsUsed: report.creditsUsed, candidates: report.uniqueCandidateCount, plannerNeurons: report.planner.totalNeurons }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
