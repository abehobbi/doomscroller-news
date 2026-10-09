import fs from 'node:fs/promises'

const API_URL = 'https://api.tavily.com/search'
const SEARCH_FAMILIES = [
  ['local-change', 'recent local reporting from anywhere in the world about a small community, village, neighbourhood, or municipality experiencing a distinctive change or solving an unusual problem'],
  ['living-traditions', 'recent original local reporting anywhere in the world about a living tradition, harvest, livelihood, food practice, craft, or community celebration with distinctive concrete details'],
  ['community-nature', 'recent local reporting worldwide about residents or volunteers restoring a wetland, forest, river, habitat, historic place, or protecting unusual wildlife'],
  ['municipal-surprise', 'recent local news anywhere in the world about an unexpected municipal error, infrastructure problem, civic dispute, or unusual public response'],
  ['ordinary-life', 'recent deeply local journalism that gives a vivid surprising window into ordinary life in an underreported place outside the United States'],
  ['local-experiment', 'recent local news worldwide about a small town community school farm or conservation group trying something genuinely novel or remarkable'],
  ['regional-original', 'recent original reporting by a regional or community news outlet about a fascinating event that would normally be missed by international news'],
  ['culture-place', 'recent reporting about a highly specific local cultural event or practice that reveals how people live in a particular place, excluding tourism promotion and generic event listings'],
].map(([id, query]) => ({ id, query }))

const NOISE = /\b(?:preview|tickets?|sponsored|press release|pr newswire|stock|earnings|podcast|opinion|newsletter|sports?|football|basketball|celebrity|shopping|travel deals?)\b/i

function parseArgs(argv) {
  const options = { mode: 'fresh', start: null, end: null, days: 3, output: null }
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === '--mode') options.mode = argv[++i]
    else if (value === '--start') options.start = argv[++i]
    else if (value === '--end') options.end = argv[++i]
    else if (value === '--days') options.days = Number(argv[++i])
    else if (value === '--output') options.output = argv[++i]
  }
  if (!['fresh', 'historical'].includes(options.mode)) throw new Error('--mode must be fresh or historical')
  if (options.mode === 'historical' && (!options.start || !options.end)) throw new Error('historical mode requires --start and --end')
  return options
}

async function search(apiKey, family, options) {
  const body = {
    query: family.query, search_depth: 'basic', max_results: 20, topic: 'general',
    include_answer: false, include_raw_content: false, include_images: false,
    include_published_date: true, filter_by_published_date: true,
    include_usage: true, safe_search: true,
  }
  if (options.mode === 'historical') {
    body.start_date = options.start
    body.end_date = options.end
  } else body.time_range = options.days <= 1 ? 'day' : 'week'

  const started = performance.now()
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(`${family.id}: HTTP ${response.status} ${payload?.detail?.error || text.slice(0, 300)}`)
  return {
    family: family.id, query: family.query,
    latencyMs: Math.round(performance.now() - started),
    credits: Number(payload?.usage?.credits || 1),
    results: Array.isArray(payload?.results) ? payload.results : [],
    requestId: payload?.request_id || null,
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

function mergeResults(searches) {
  const byUrl = new Map()
  for (const search of searches) for (const result of search.results) {
    const url = normalizeUrl(result.url)
    if (!url) continue
    const existing = byUrl.get(url)
    const candidate = {
      title: String(result.title || '').trim(), url,
      snippet: String(result.content || '').trim(),
      publishedAt: result.published_date || null,
      providerScore: Number(result.score || 0), foundBy: [search.family],
    }
    if (!existing) byUrl.set(url, candidate)
    else {
      existing.foundBy = [...new Set([...existing.foundBy, search.family])]
      existing.providerScore = Math.max(existing.providerScore, candidate.providerScore)
      if (candidate.snippet.length > existing.snippet.length) existing.snippet = candidate.snippet
    }
  }
  return [...byUrl.values()].map(item => {
    const obviousNoise = NOISE.test(`${item.title} ${item.url}`)
    return {
      ...item, obviousNoise,
      discoveryScore: Number((item.providerScore + Math.min(0.24, (item.foundBy.length - 1) * 0.08) - (obviousNoise ? 0.5 : 0)).toFixed(4)),
    }
  }).sort((a, b) => b.discoveryScore - a.discoveryScore)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set. No requests were made.')
  const searches = []
  for (const family of SEARCH_FAMILIES) searches.push(await search(apiKey, family, options))
  const candidates = mergeResults(searches)
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'tavily', mode: options.mode,
    requestedWindow: options.mode === 'historical' ? { start: options.start, end: options.end } : { days: options.days },
    queryCount: searches.length,
    creditsUsed: searches.reduce((sum, value) => sum + value.credits, 0),
    rawResultCount: searches.reduce((sum, value) => sum + value.results.length, 0),
    uniqueCandidateCount: candidates.length,
    searches: searches.map(({ results, ...metadata }) => ({ ...metadata, resultCount: results.length })), candidates,
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) await fs.writeFile(options.output, json, 'utf8')
  else process.stdout.write(json)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

