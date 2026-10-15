import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIVE_LANE_QUERIES, UPDATE_LANES } from './five-lane-queries.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDE_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'tripadvisor.com', 'youtube.com', 'x.com']

function parseArgs(argv) {
  const options = { scan: 'full', lanes: [], days: 3, resultsPerQuery: 10, maxQueries: null, output: null, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scan') options.scan = argv[++i]
    else if (argv[i] === '--lanes') options.lanes = argv[++i].split(',').map(value => value.trim()).filter(Boolean)
    else if (argv[i] === '--days') options.days = Number(argv[++i])
    else if (argv[i] === '--results-per-query') options.resultsPerQuery = Number(argv[++i])
    else if (argv[i] === '--max-queries') options.maxQueries = Number(argv[++i])
    else if (argv[i] === '--output') options.output = argv[++i]
    else if (argv[i] === '--dry-run') options.dryRun = true
  }
  if (!['all', 'full', 'major', 'update', 'depth'].includes(options.scan)) throw new Error('--scan must be all, major, or depth')
  const knownLanes = new Set(FIVE_LANE_QUERIES.map(query => query.lane))
  if (options.lanes.some(lane => !knownLanes.has(lane))) throw new Error('--lanes contains an unknown editorial lane')
  if (!Number.isFinite(options.days) || options.days < 1) throw new Error('--days must be at least 1')
  if (!Number.isInteger(options.resultsPerQuery) || options.resultsPerQuery < 1 || options.resultsPerQuery > 100) throw new Error('--results-per-query must be an integer from 1 to 100')
  if (options.maxQueries !== null && (!Number.isInteger(options.maxQueries) || options.maxQueries < 1)) throw new Error('--max-queries must be a positive integer')
  return options
}

export function selectedQueries(scan, lanes = []) {
  let selected
  const routineQueries = FIVE_LANE_QUERIES.filter(query => !query.recoveryOnly)
  if (scan === 'major' || scan === 'update') selected = routineQueries.filter(query => UPDATE_LANES.has(query.lane))
  else if (scan === 'depth') selected = routineQueries.filter(query => !UPDATE_LANES.has(query.lane))
  else selected = routineQueries
  return lanes.length ? selected.filter(query => lanes.includes(query.lane)) : selected
}

export function budgetQueries(queries, maximum = null) {
  if (!maximum || queries.length <= maximum) return [...queries]
  const remaining = [...queries], selected = [], laneCounts = new Map(), regionCounts = new Map()
  while (remaining.length && selected.length < maximum) {
    const ranked = remaining.map((query, index) => {
      const newLane = !laneCounts.has(query.lane), newRegion = query.region && !regionCounts.has(query.region)
      const majorBonus = query.lane.includes('major') ? 8 : 0
      const score = Number(newLane) * 120 + Number(newRegion) * 40 + majorBonus - (laneCounts.get(query.lane) || 0) * 18 - (regionCounts.get(query.region) || 0) * 5 - index / 1000
      return { query, score }
    }).sort((a, b) => b.score - a.score)
    const choice = ranked[0].query
    selected.push(choice); remaining.splice(remaining.indexOf(choice), 1)
    laneCounts.set(choice.lane, (laneCounts.get(choice.lane) || 0) + 1)
    if (choice.region) regionCounts.set(choice.region, (regionCounts.get(choice.region) || 0) + 1)
  }
  return selected
}

export function isProviderLimitError(error) {
  return /HTTP\s+402|exceeded (?:your )?(?:credits?|quota)|payment required/i.test(String(error?.message || error || ''))
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

async function runQuery(apiKey, definition, options, window) {
  const body = {
    query: definition.query,
    objective: definition.objective,
    type: 'auto',
    category: 'news',
    numResults: options.resultsPerQuery,
    moderation: true,
    excludeDomains: EXCLUDE_DOMAINS,
    startPublishedDate: window.start,
    endPublishedDate: window.end,
  }
  const started = performance.now()
  const response = await fetch(API_URL, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(`${definition.id}: HTTP ${response.status} ${payload?.error || text.slice(0, 300)}`)
  return {
    ...definition,
    requestId: payload?.requestId || null,
    latencyMs: Math.round(performance.now() - started),
    searchTimeMs: Number(payload?.searchTime || 0),
    costDollars: Number(payload?.costDollars?.total || 0),
    results: Array.isArray(payload?.results) ? payload.results : [],
  }
}

function mergeResults(searches) {
  const byUrl = new Map()
  for (const search of searches) for (const [position, result] of search.results.entries()) {
    const url = normalizeUrl(result.url)
    if (!url) continue
    const discovery = { lane: search.lane, region: search.region || null, queryId: search.id, position: position + 1 }
    const existing = byUrl.get(url)
    if (!existing) {
      byUrl.set(url, {
        title: String(result.title || '').trim(), url,
        publishedAt: result.publishedDate || null, author: result.author || null,
        image: result.image || null, discoveries: [discovery],
      })
    } else existing.discoveries.push(discovery)
  }
  return [...byUrl.values()].map(candidate => ({
    ...candidate,
    lanes: [...new Set(candidate.discoveries.map(value => value.lane))],
    priorityRegions: [...new Set(candidate.discoveries.map(value => value.region).filter(Boolean))],
    queryIds: [...new Set(candidate.discoveries.map(value => value.queryId))],
    bestPosition: Math.min(...candidate.discoveries.map(value => value.position)),
  }))
}

function buildReport({ options, queries, searches, window, status = 'complete', deferral = null }) {
  const candidates = mergeResults(searches)
  const laneCounts = {}
  for (const lane of new Set(queries.map(query => query.lane))) {
    laneCounts[lane] = {
      plannedQueries: queries.filter(query => query.lane === lane).length,
      completedQueries: searches.filter(search => search.lane === lane).length,
      queries: searches.filter(search => search.lane === lane).length,
      rawResults: searches.filter(search => search.lane === lane).reduce((sum, search) => sum + search.results.length, 0),
      uniqueCandidates: candidates.filter(candidate => candidate.lanes.includes(lane)).length,
    }
  }
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'exa', scan: options.scan,
    status, deferral, requestedWindow: window, plannedQueryCount: queries.length,
    queryCount: searches.length, remainingQueryIds: queries.slice(searches.length).map(query => query.id),
    resultsPerQuery: options.resultsPerQuery,
    estimatedCostDollars: Number((queries.length * 0.007).toFixed(3)),
    costDollars: Number(searches.reduce((sum, search) => sum + search.costDollars, 0).toFixed(6)),
    rawResultCount: searches.reduce((sum, search) => sum + search.results.length, 0),
    uniqueCandidateCount: candidates.length, laneCounts,
    searches: searches.map(({ results, ...metadata }) => ({ ...metadata, resultCount: results.length })),
    candidates,
  }
}

async function writeReport(output, report) {
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (!output) {
    process.stdout.write(json)
    return
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, json, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const queries = budgetQueries(selectedQueries(options.scan, options.lanes), options.maxQueries)
  if (!queries.length) throw new Error('No queries match the requested scan and lanes')
  const estimatedCost = Number((queries.length * 0.007).toFixed(3))
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ scan: options.scan, lanes: options.lanes, queryCount: queries.length, resultsPerQuery: options.resultsPerQuery, estimatedCostDollars: estimatedCost, queries }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  const end = new Date()
  const start = new Date(end.getTime() - options.days * 86_400_000)
  const window = { start: start.toISOString(), end: end.toISOString() }
  const searches = []
  for (const query of queries) {
    try {
      searches.push(await runQuery(apiKey, query, options, window))
      if (options.output) await writeReport(options.output, buildReport({ options, queries, searches, window, status: 'running' }))
    } catch (error) {
      const providerLimited = isProviderLimitError(error)
      await writeReport(options.output, buildReport({
        options, queries, searches, window,
        status: providerLimited ? 'deferred' : 'failed',
        deferral: { reason: providerLimited ? 'provider-quota' : 'request-failure', failedQueryId: query.id },
      }))
      if (providerLimited) throw new Error(`Discovery deferred after ${searches.length} of ${queries.length} searches because the free provider allowance was exhausted.`)
      throw error
    }
  }
  await writeReport(options.output, buildReport({ options, queries, searches, window }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
