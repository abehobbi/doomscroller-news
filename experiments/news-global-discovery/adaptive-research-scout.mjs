import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStrict } from '../../artifacts/summary-feasibility/round-9/strict-json.mjs'
import { buildTavilyDiscoveryReport } from './tavily-complementary-scout.mjs'

export const MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const ROUND_SIZES = Object.freeze([3, 2])
export const MAX_TAVILY_CREDITS = 5
export const ALLOWED_LANES = new Set(['world-interesting', 'priority-interesting', 'discovery'])
const PRIORITY_REGIONS = ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']

const SYSTEM_PROMPT = `You are the adaptive research planner for Doomscroller News. Identify valuable stories the current search pool is likely to have OMITTED, then write precise web-search queries that can find them.

Prioritize distinctive original local reporting from small places and undercovered countries; ordinary life, livelihoods, exploitation, public services, environment, culture, identity, living traditions, crafts, language, heritage, community change, rescues and unusual human stories; Syria, the wider Middle East, Bangladesh, Ghana, Canada and the GTA without padding; and accessible archaeology, history, science, nature, medicine and field discoveries with a concrete new finding.

Avoid dominant headlines already present, generic topic searches, speeches, ceremonies, publicity, partnerships, event listings, tourism, sport, celebrity news, opinion and vague explainers. Every query must demand a concrete article published inside the supplied date window. Search different editorial blind spots rather than variations of one idea. Do not invent a story; construct queries broad enough to discover real reporting but specific enough to escape generic rankings.`

function schema(count) {
  return { name: 'doomscroller_adaptive_queries', strict: true, schema: {
    type: 'object', additionalProperties: false, required: ['queries'], properties: { queries: {
      type: 'array', minItems: count, maxItems: count, items: {
        type: 'object', additionalProperties: false, required: ['id', 'lane', 'region', 'blind_spot', 'query', 'rationale'],
        properties: {
          id: { type: 'string', minLength: 4, maxLength: 60 }, lane: { type: 'string', enum: [...ALLOWED_LANES] },
          region: { type: ['string', 'null'], enum: [null, ...PRIORITY_REGIONS] }, blind_spot: { type: 'string', minLength: 8, maxLength: 120 },
          query: { type: 'string', minLength: 40, maxLength: 700 }, rationale: { type: 'string', minLength: 8, maxLength: 180 },
        },
      },
    } },
  } }
}

export function compactDiscoveryContext(reports, { maximumHeadlines = 80 } = {}) {
  const candidates = reports.flatMap(report => report?.candidates || []), laneCounts = {}, regionCounts = {}
  for (const candidate of candidates) {
    for (const lane of candidate.lanes || []) laneCounts[lane] = (laneCounts[lane] || 0) + 1
    for (const region of candidate.priorityRegions || []) regionCounts[region] = (regionCounts[region] || 0) + 1
  }
  const seen = new Set(), headlines = []
  for (const candidate of candidates) {
    const title = String(candidate.title || '').replace(/\s+/g, ' ').trim(), key = title.toLowerCase()
    if (!title || seen.has(key)) continue
    seen.add(key); headlines.push({ title, lanes: candidate.lanes || [], regions: candidate.priorityRegions || [] })
    if (headlines.length >= maximumHeadlines) break
  }
  return { candidateCount: candidates.length, laneCounts, regionCounts, headlines }
}

export function auditPlannedQueries(queries, expectedCount, priorQueries = []) {
  if (!Array.isArray(queries) || queries.length !== expectedCount) return { valid: false, reason: 'wrong query count' }
  const normalized = queries.map(item => String(item?.query || '').toLowerCase().replace(/\s+/g, ' ').trim())
  if (new Set(normalized).size !== normalized.length) return { valid: false, reason: 'duplicate adaptive query' }
  const prior = new Set(priorQueries.map(value => String(value).toLowerCase().replace(/\s+/g, ' ').trim()))
  if (normalized.some(value => prior.has(value))) return { valid: false, reason: 'query repeats an earlier round' }
  if (queries.some(item => !ALLOWED_LANES.has(item?.lane))) return { valid: false, reason: 'disallowed lane' }
  if (queries.some(item => item.lane === 'priority-interesting' && !PRIORITY_REGIONS.includes(item.region))) return { valid: false, reason: 'priority query lacks a supported region' }
  if (queries.some(item => item.lane !== 'priority-interesting' && item.region !== null)) return { valid: false, reason: 'non-priority query has a priority region' }
  if (queries.some(item => String(item.query || '').length < 40)) return { valid: false, reason: 'query is too generic' }
  return { valid: true, reason: null }
}

function credentials() {
  if (process.env.FREE_PLAN_CONFIRMED !== 'yes') throw new Error('FREE_PLAN_CONFIRMED=yes is required; no paid fallback exists')
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN || !process.env.TAVILY_API_KEY) throw new Error('Adaptive scout credentials are missing')
  return { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, tavilyKey: process.env.TAVILY_API_KEY }
}

function exposedResponse(body) { return body?.result?.response ?? body?.result?.choices?.[0]?.message?.content ?? null }

export async function planQueries({ context, priorSearches = [], count, round, fetchImpl = fetch }) {
  const { accountId, token } = credentials()
  const request = { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ round, requested_query_count: count, date_window: context.requestedWindow, current_pool: context.pool, prior_adaptive_results: priorSearches }) }],
    temperature: 0.25, max_completion_tokens: 1200, response_format: { type: 'json_schema', json_schema: schema(count) }, chat_template_kwargs: { enable_thinking: false }, store: false }
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(110_000) })
  const raw = await response.text(), body = parseStrict(raw)
  if (!response.ok || body?.success === false) throw new Error(`adaptive planner round ${round}: HTTP ${response.status}`)
  const exposed = exposedResponse(body), parsed = typeof exposed === 'string' ? parseStrict(exposed) : exposed
  const audit = auditPlannedQueries(parsed?.queries, count, priorSearches.map(item => item.query))
  if (!audit.valid) throw new Error(`adaptive planner round ${round}: ${audit.reason}`)
  return { queries: parsed.queries, usage: body?.result?.usage ?? body?.usage ?? null, returnedModel: body?.result?.model ?? null }
}

async function searchTavily(definition, window, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: definition.query, search_depth: 'basic', max_results: 20, topic: 'news', start_date: window.start.slice(0, 10), end_date: window.end.slice(0, 10), include_published_date: true, filter_by_published_date: true, include_answer: false, include_raw_content: false, include_images: false, include_usage: true, safe_search: true }) })
  const raw = await response.text(), payload = parseStrict(raw)
  if (!response.ok) throw new Error(`${definition.id}: HTTP ${response.status}`)
  return { ...definition, role: 'adaptive-recall', requestId: payload?.request_id || null, creditsUsed: Number(payload?.usage?.credits || 1), results: payload?.results || [] }
}

export function compactRoundResults(searches) {
  return searches.map(search => ({ query: search.query, lane: search.lane, region: search.region, blind_spot: search.blind_spot, results: (search.results || []).slice(0, 12).map(item => ({ title: item.title, url: item.url, published_at: item.published_date || null })) }))
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }

async function main() {
  const args = process.argv.slice(2), values = flag => { const found = []; for (let i = 0; i < args.length; i += 1) if (args[i] === flag) found.push(args[++i]); return found }
  const inputs = values('--input'), output = values('--output')[0], scan = values('--scan')[0] || 'full'
  if (!inputs.length || !output) throw new Error('at least one --input and --output are required')
  if (args.includes('--dry-run')) { process.stdout.write(`${JSON.stringify({ rounds: ROUND_SIZES, maximumTavilyCredits: MAX_TAVILY_CREDITS }, null, 2)}\n`); return }
  const end = new Date(), start = new Date(end.getTime() - 3 * 86_400_000), window = { start: start.toISOString(), end: end.toISOString() }
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
      if (searches.reduce((sum, value) => sum + value.creditsUsed, 0) >= MAX_TAVILY_CREDITS) throw new Error('Adaptive discovery stopped before exceeding its Tavily credit ceiling')
      searches.push(await searchTavily({ ...item, id: `adaptive-r${index + 1}-${item.id}` }, window, tavilyKey))
    }
  }
  const report = buildTavilyDiscoveryReport(searches, window)
  report.mode = 'adaptive-research'; report.planner = { model: MODEL, calls: plannerCalls, totalNeurons: plannerCalls.reduce((sum, call) => sum + Number(call.usage?.neurons || 0), 0) }
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ queries: report.queryCount, creditsUsed: report.creditsUsed, candidates: report.uniqueCandidateCount, plannerNeurons: report.planner.totalNeurons }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
