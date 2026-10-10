import fs from 'node:fs/promises'
import { FIVE_LANE_QUERIES, UPDATE_LANES } from './five-lane-queries.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDE_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'tripadvisor.com', 'youtube.com', 'x.com']

function parseArgs(argv) {
  const options = { scan: 'full', days: 3, output: null, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scan') options.scan = argv[++i]
    else if (argv[i] === '--days') options.days = Number(argv[++i])
    else if (argv[i] === '--output') options.output = argv[++i]
    else if (argv[i] === '--dry-run') options.dryRun = true
  }
  if (!['full', 'update'].includes(options.scan)) throw new Error('--scan must be full or update')
  if (!Number.isFinite(options.days) || options.days < 1) throw new Error('--days must be at least 1')
  return options
}

function selectedQueries(scan) {
  return scan === 'update' ? FIVE_LANE_QUERIES.filter(query => UPDATE_LANES.has(query.lane)) : FIVE_LANE_QUERIES
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
    numResults: 10,
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const queries = selectedQueries(options.scan)
  const estimatedCost = Number((queries.length * 0.007).toFixed(3))
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ scan: options.scan, queryCount: queries.length, estimatedCostDollars: estimatedCost, queries }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  const end = new Date()
  const start = new Date(end.getTime() - options.days * 86_400_000)
  const window = { start: start.toISOString(), end: end.toISOString() }
  const searches = []
  for (const query of queries) searches.push(await runQuery(apiKey, query, options, window))
  const candidates = mergeResults(searches)
  const laneCounts = {}
  for (const lane of new Set(queries.map(query => query.lane))) {
    laneCounts[lane] = {
      queries: searches.filter(search => search.lane === lane).length,
      rawResults: searches.filter(search => search.lane === lane).reduce((sum, search) => sum + search.results.length, 0),
      uniqueCandidates: candidates.filter(candidate => candidate.lanes.includes(lane)).length,
    }
  }
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'exa', scan: options.scan,
    requestedWindow: window, queryCount: searches.length,
    costDollars: Number(searches.reduce((sum, search) => sum + search.costDollars, 0).toFixed(6)),
    rawResultCount: searches.reduce((sum, search) => sum + search.results.length, 0),
    uniqueCandidateCount: candidates.length, laneCounts,
    searches: searches.map(({ results, ...metadata }) => ({ ...metadata, resultCount: results.length })),
    candidates,
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) await fs.writeFile(options.output, json, 'utf8')
  else process.stdout.write(json)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
