import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDE_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'tripadvisor.com', 'youtube.com', 'x.com']

export function selectGapQueries(edition) {
  const laneGaps = edition.audit?.laneGaps || {}
  const regionGaps = edition.audit?.regionGaps || {}
  const selected = FIVE_LANE_QUERIES.filter(query => Number(laneGaps[query.lane] || 0) > 0 || (query.region && Number(regionGaps[query.region] || 0) > 0))
  return [...new Map(selected.map(query => [query.id, query])).values()]
}

function normalizeUrl(value) {
  try {
    const url = new URL(value); url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

async function search(apiKey, definition, window, resultsPerQuery) {
  const response = await fetch(API_URL, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: definition.query, objective: definition.objective, type: 'auto', category: 'news', numResults: resultsPerQuery, moderation: true, excludeDomains: EXCLUDE_DOMAINS, startPublishedDate: window.start, endPublishedDate: window.end }),
  })
  const text = await response.text(); let payload = null
  try { payload = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(`${definition.id}: HTTP ${response.status} ${payload?.error || text.slice(0, 240)}`)
  return { ...definition, requestId: payload?.requestId || null, costDollars: Number(payload?.costDollars?.total || 0), results: payload?.results || [] }
}

function candidatesFrom(searches) {
  const byUrl = new Map()
  for (const search of searches) for (const [index, item] of search.results.entries()) {
    const url = normalizeUrl(item.url); if (!url) continue
    const discovery = { lane: search.lane, region: search.region || null, queryId: search.id, position: index + 1 }
    const prior = byUrl.get(url)
    if (!prior) byUrl.set(url, { title: item.title || '', url, publishedAt: item.publishedDate || null, author: item.author || null, image: item.image || null, discoveries: [discovery], lanes: [search.lane], priorityRegions: search.region ? [search.region] : [], queryIds: [search.id], bestPosition: index + 1 })
    else {
      prior.discoveries.push(discovery); prior.lanes = [...new Set([...prior.lanes, search.lane])]
      prior.priorityRegions = [...new Set([...prior.priorityRegions, search.region].filter(Boolean))]
      prior.queryIds = [...new Set([...prior.queryIds, search.id])]; prior.bestPosition = Math.min(prior.bestPosition, index + 1)
    }
  }
  return [...byUrl.values()]
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const editionPath = value('--edition'), discoveryPath = value('--discovery'), output = value('--output')
  const resultsPerQuery = Number(value('--results-per-query') || 10)
  if (!editionPath || !discoveryPath || !output) throw new Error('--edition, --discovery and --output are required')
  const [edition, discovery] = await Promise.all([editionPath, discoveryPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const queries = selectGapQueries(edition), window = discovery.requestedWindow
  const searches = []
  if (queries.length) {
    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
    for (const query of queries) searches.push(await search(apiKey, query, window, resultsPerQuery))
  }
  const candidates = candidatesFrom(searches)
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'exa', scan: 'dynamic-gap-recovery', requestedWindow: window, requestedLaneGaps: edition.audit?.laneGaps || {}, requestedRegionGaps: edition.audit?.regionGaps || {}, queryCount: searches.length, resultsPerQuery, costDollars: Number(searches.reduce((sum, item) => sum + item.costDollars, 0).toFixed(6)), rawResultCount: searches.reduce((sum, item) => sum + item.results.length, 0), uniqueCandidateCount: candidates.length, searches: searches.map(({ results, ...item }) => ({ ...item, resultCount: results.length })), candidates }
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `query_count=${report.queryCount}\n`)
  process.stdout.write(`${JSON.stringify({ queries: report.queryCount, candidates: report.uniqueCandidateCount, costDollars: report.costDollars, laneGaps: report.requestedLaneGaps, regionGaps: report.requestedRegionGaps }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
