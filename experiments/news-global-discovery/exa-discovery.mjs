import fs from 'node:fs/promises'

const API_URL = 'https://api.exa.ai/search'
const SEARCH_FAMILIES = [
  ['local-change', 'A recently published local news story about a distinctive change in a village, neighbourhood, small town, or underreported community somewhere outside the United States.'],
  ['living-traditions', 'Recent original reporting about a living tradition, harvest, livelihood, craft, food practice, or community celebration in a specific place outside the United States.'],
  ['community-nature', 'Recent local reporting about a community protecting unusual wildlife or restoring a river, forest, wetland, habitat, or historic landscape outside the United States.'],
  ['municipal-surprise', 'A recent surprising local news event involving a municipality, infrastructure problem, civic dispute, or unusual public response outside the United States.'],
  ['ordinary-life', 'Recent original journalism offering a vivid and surprising window into ordinary life in an underreported place outside the United States.'],
  ['local-experiment', 'Recent news about a small community, school, farm, or conservation group outside the United States trying something genuinely novel or remarkable.'],
  ['regional-original', 'A fascinating recent event reported by a regional or community news outlet outside the United States that international news would normally miss.'],
  ['culture-place', 'Recent substantive reporting about a highly specific local cultural practice that reveals how people live in a particular place outside the United States.'],
].map(([id, query]) => ({ id, query }))

const EXCLUDE_DOMAINS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com',
  'tripadvisor.com', 'youtube.com', 'x.com',
]
const NOISE = /\b(?:tickets?|sponsored|press release|pr newswire|stock|earnings|podcast|opinion|newsletter|shopping|travel deals?|event calendar|legal notice)\b/i

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
  if (options.mode === 'fresh' && (!Number.isFinite(options.days) || options.days < 1)) throw new Error('--days must be at least 1')
  return options
}

function startOfDay(value) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

function endOfDay(value) {
  return new Date(`${value}T23:59:59.999Z`).toISOString()
}

async function search(apiKey, family, options) {
  const body = {
    query: family.query,
    type: 'auto',
    category: 'news',
    numResults: 10,
    moderation: true,
    excludeDomains: EXCLUDE_DOMAINS,
    objective: 'Rank distinct, recently reported, concrete local events outside the United States. Prefer original journalism with a specific place, action, and human consequence. Exclude tourism promotion, generic explainers, event listings, publicity, opinion, sport, celebrity news, and homepages.',
  }
  if (options.mode === 'historical') {
    body.startPublishedDate = startOfDay(options.start)
    body.endPublishedDate = endOfDay(options.end)
  } else {
    body.startPublishedDate = new Date(Date.now() - options.days * 86_400_000).toISOString()
    body.endPublishedDate = new Date().toISOString()
  }

  const started = performance.now()
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(`${family.id}: HTTP ${response.status} ${payload?.error || text.slice(0, 300)}`)
  return {
    family: family.id,
    query: family.query,
    latencyMs: Math.round(performance.now() - started),
    costDollars: Number(payload?.costDollars?.total || 0),
    searchTimeMs: Number(payload?.searchTime || 0),
    resolvedSearchType: payload?.resolvedSearchType || null,
    requestId: payload?.requestId || null,
    results: Array.isArray(payload?.results) ? payload.results : [],
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
    const candidate = {
      title: String(result.title || '').trim(),
      url,
      publishedAt: result.publishedDate || null,
      author: result.author || null,
      image: result.image || null,
      foundBy: [search.family],
    }
    const existing = byUrl.get(url)
    if (!existing) byUrl.set(url, candidate)
    else existing.foundBy = [...new Set([...existing.foundBy, search.family])]
  }
  return [...byUrl.values()].map(item => ({
    ...item,
    obviousNoise: NOISE.test(`${item.title} ${item.url}`),
  }))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  const searches = []
  for (const family of SEARCH_FAMILIES) searches.push(await search(apiKey, family, options))
  const candidates = mergeResults(searches)
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    provider: 'exa',
    mode: options.mode,
    requestedWindow: options.mode === 'historical' ? { start: options.start, end: options.end } : { days: options.days },
    queryCount: searches.length,
    costDollars: Number(searches.reduce((sum, value) => sum + value.costDollars, 0).toFixed(6)),
    rawResultCount: searches.reduce((sum, value) => sum + value.results.length, 0),
    uniqueCandidateCount: candidates.length,
    searches: searches.map(({ results, ...metadata }) => ({ ...metadata, resultCount: results.length })),
    candidates,
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) await fs.writeFile(options.output, json, 'utf8')
  else process.stdout.write(json)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
