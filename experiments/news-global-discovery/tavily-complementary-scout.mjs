import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TAVILY_COMPLEMENTARY_QUERIES = [
  { id: 'tavily-undercovered-consequences', role: 'undercovered-public-impact', lane: 'world-major', query: 'Original local or regional reporting from the last 3 days about one concrete, consequential development outside the dominant international headlines: a court or regulator ruling, outbreak, labour action, institutional failure, civilian harm, public-service breakdown, or measurable economic shock. Return specific dated articles, not homepages, roundups, transcripts, videos, commentary, or press releases.' },
  { id: 'tavily-priority-local-accountability', role: 'priority-local-recall', lane: 'priority-interesting', query: 'Original local reporting from the last 3 days in Syria, Bangladesh, Ghana, Canada, Toronto, or the wider Middle East about an overlooked public problem, abuse, livelihood, environmental burden, community response, or distinctive change in daily life. Prefer named places and affected people. Exclude speeches, publicity, ceremonies, partnerships, opinion, sport, and generic national summaries.' },
  { id: 'tavily-priority-major-public-impact', role: 'priority-major-public-impact', lane: 'priority-major', query: 'Specific dated reporting from the last 3 days about a consequential action or event in Syria, Bangladesh, Ghana, Canada, Toronto, or the wider Middle East: a cross-border strike, central-bank or court decision, censorship action, critical-infrastructure failure, disaster, outbreak, labour action, corruption case, or environmental enforcement with a concrete public impact. Prefer original local reporting and exact articles. Exclude speeches, proposals, analysis-only pieces, routine political process, homepages, and press releases.' },
  { id: 'tavily-power-accountability', role: 'state-and-corporate-accountability', lane: 'world-major', query: 'Original reporting from the last 3 days documenting a concrete state or corporate abuse, forced displacement or buyout, press-freedom action, dangerous infrastructure decision, regulatory failure, lethal enforcement action, or other exercise of power with identifiable affected people. Prefer investigations, court records, regulators, and local journalism. Exclude allegations without attributable evidence, commentary, publicity, generic explainers, and press releases.' },
  { id: 'tavily-small-place-change', role: 'small-place-local-reporting', lane: 'world-interesting', query: 'A specific, recently reported story from a village, island, neighbourhood, small town, fishery, farm, school, market, or local industry showing an unusual change in how people live or work. Prefer original local journalism with a named place and concrete event. Exclude tourism promotion, event listings, profiles without a new development, and institutional announcements.' },
  { id: 'tavily-living-culture-heritage', role: 'living-culture-and-heritage', lane: 'world-interesting', query: 'A specific story newly reported in the last 3 days about a living tradition, cultural revival, historic site, craft, language, community memory, restoration, or heritage dispute that reveals something larger about a named place. Return reported articles, not calendars, travel guides, publicity, or ceremonial announcements.' },
  { id: 'tavily-field-discoveries', role: 'accessible-field-discovery', lane: 'discovery', query: 'A concrete scientific, archaeological, historical, wildlife, ecology, medical, or space finding newly reported in the last 3 days, based on named researchers, fieldwork, a paper, excavation, tracking project, or official mission. Prefer accessible reporting with a clear finding. Exclude generic explainers, speculative releases, videos, and incremental specialist abstracts.' },
  { id: 'tavily-environment-place', role: 'environment-and-place', lane: 'world-interesting', query: 'Original local or specialist reporting from the last 3 days about a concrete environmental change, conservation decision, water crisis, mining impact, threatened habitat, unusual wildlife event, or climate consequence in a named place, especially outside major English-language headlines. Prefer measurable effects and affected communities. Exclude awareness campaigns, generic climate commentary, tourism, publicity, and press releases.' },
]

const GENERIC_TITLE = /^(?:home|news|press releases?|international affairs forum|ministry of(?:\s+.+)?|latest news|top stories)$/i
const PROMOTIONAL_TITLE = /\b(?:press release|to deliver (?:the )?(?:closing )?keynote|presents new pivotal trial data|sponsored content)\b/i

export function candidateRejectionReason(result) {
  const title = String(result?.title || '').trim()
  let parsed
  try { parsed = new URL(result?.url) } catch { return 'invalid-url' }
  if (!title) return 'missing-title'
  if (GENERIC_TITLE.test(title)) return 'generic-index-title'
  if (PROMOTIONAL_TITLE.test(title)) return 'promotional-or-press-release'
  if (/\.pdf$/i.test(parsed.pathname)) return 'non-article-pdf'
  if (/\/(?:video|videos)\//i.test(parsed.pathname)) return 'video-only-result'
  return null
}

function normalizeUrl(value) {
  try {
    const url = new URL(value); url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

export function buildTavilyDiscoveryReport(searches, window) {
  const byUrl = new Map()
  const rejectedCandidates = []
  for (const search of searches) for (const [index, result] of (search.results || []).entries()) {
    const rejectionReason = candidateRejectionReason(result)
    if (rejectionReason) {
      rejectedCandidates.push({ queryId: search.id, title: String(result.title || '').trim(), url: String(result.url || ''), reason: rejectionReason })
      continue
    }
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
    rejectedCandidateCount: rejectedCandidates.length, rejectionCounts: Object.fromEntries([...new Set(rejectedCandidates.map(item => item.reason))].sort().map(reason => [reason, rejectedCandidates.filter(item => item.reason === reason).length])),
    searches: searches.map(({ results, ...item }) => ({ ...item, resultCount: results.length })), rejectedCandidates, candidates }
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
