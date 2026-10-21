import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TAVILY_COMPLEMENTARY_QUERIES = [
  { id: 'tavily-world-consequential', lane: 'world-major', query: 'Most consequential concrete world news developments from the last 3 days that may be undercovered: government actions, conflict, law, economy, public health, disasters, human rights, or large direct human impact' },
  { id: 'tavily-country-consequences', lane: 'world-major', query: 'Important country-level developments from the last 3 days outside the dominant global headlines, including outbreaks, court rulings, elections, inflation, protests, institutional failures, and civilian harm' },
  { id: 'tavily-priority-regions', lane: 'priority-major', query: 'Consequential concrete news from the last 3 days in Syria, Bangladesh, Ghana, Canada, Toronto, or the wider Middle East; exclude speeches, publicity and opinion' },
  { id: 'tavily-local-niche', lane: 'world-interesting', query: 'Genuinely fascinating small or niche local stories from the last 3 days about unusual places, livelihoods, culture, environmental change, animals, archaeology, or overlooked public problems' },
  { id: 'tavily-discoveries', lane: 'discovery', query: 'Strong understandable scientific, medical, archaeology, nature, animal, climate, or space discoveries newly reported in the last 3 days' },
]

function normalizeUrl(value) {
  try {
    const url = new URL(value); url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

export function buildTavilyDiscoveryReport(searches, window) {
  const byUrl = new Map()
  for (const search of searches) for (const [index, result] of (search.results || []).entries()) {
    const url = normalizeUrl(result.url)
    if (!url) continue
    const discovery = { lane: search.lane, region: null, queryId: search.id, position: index + 1 }
    const current = byUrl.get(url)
    if (current) current.discoveries.push(discovery)
    else byUrl.set(url, { title: String(result.title || '').trim(), url, publishedAt: result.published_date || null, author: null, image: null, discoveries: [discovery] })
  }
  const candidates = [...byUrl.values()].map(item => ({ ...item,
    lanes: [...new Set(item.discoveries.map(value => value.lane))], priorityRegions: [],
    queryIds: [...new Set(item.discoveries.map(value => value.queryId))], bestPosition: Math.min(...item.discoveries.map(value => value.position)), discoverySources: ['tavily'],
  }))
  return { schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'tavily', requestedWindow: window,
    queryCount: searches.length, creditsUsed: searches.reduce((sum, item) => sum + Number(item.creditsUsed || 1), 0), costDollars: 0,
    rawResultCount: searches.reduce((sum, item) => sum + item.results.length, 0), uniqueCandidateCount: candidates.length,
    searches: searches.map(({ results, ...item }) => ({ ...item, resultCount: results.length })), candidates }
}

async function main() {
  const args = process.argv.slice(2), outputIndex = args.indexOf('--output')
  if (outputIndex < 0) throw new Error('--output is required')
  const output = args[outputIndex + 1]
  if (args.includes('--dry-run')) { process.stdout.write(`${JSON.stringify({ queries: 5, estimatedCredits: 5 }, null, 2)}\n`); return }
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set. No requests were made.')
  const end = new Date(), start = new Date(end.getTime() - 3 * 86_400_000)
  const window = { start: start.toISOString(), end: end.toISOString() }, searches = []
  for (const definition of TAVILY_COMPLEMENTARY_QUERIES) {
    const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      query: definition.query, search_depth: 'basic', max_results: 20, topic: 'news', start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), include_published_date: true,
      filter_by_published_date: true, include_answer: false, include_raw_content: false, include_images: false, include_usage: true, safe_search: true,
    }) })
    const raw = await response.text(); let payload = null
    try { payload = JSON.parse(raw) } catch {}
    if (!response.ok) throw new Error(`${definition.id}: HTTP ${response.status}: ${payload?.detail?.error || raw.slice(0, 180)}`)
    searches.push({ ...definition, requestId: payload?.request_id || null, creditsUsed: Number(payload?.usage?.credits || 1), results: payload?.results || [] })
  }
  const report = buildTavilyDiscoveryReport(searches, window)
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ queries: report.queryCount, creditsUsed: report.creditsUsed, candidates: report.uniqueCandidateCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
