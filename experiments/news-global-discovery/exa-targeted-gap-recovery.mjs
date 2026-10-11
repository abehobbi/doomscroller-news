import fs from 'node:fs/promises'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDE_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'tripadvisor.com', 'youtube.com', 'x.com']

export const TARGETS = [
  ['sudan-drone-strike', 'Sudan drone strike killed 41 displaced people including eight children Blue Nile October 10 2026', 'Recover reputable reporting or a primary institutional statement for the reported strike. Prefer AP, Reuters, the UN, recognized rights monitors, or established regional reporting.'],
  ['panama-earthquake', 'Panama magnitude 7.7 earthquake damaged buildings roads historic structures October 9 2026', 'Recover authoritative or established reporting on the earthquake, its damage, casualties, aftershocks, and canal operations.'],
  ['canada-jobs', 'Canada lost 68,300 jobs September unemployment 6.5 October 9 2026 Statistics Canada', 'Recover Statistics Canada data and strong independent reporting about the September labour-force release.'],
  ['navi-pillay-nobel', 'Navi Pillay wins 2026 Nobel Peace Prize October 9 2026', 'Recover the Nobel Committee announcement and strong independent reporting.'],
  ['bangladesh-pirojpur-corruption', 'Bangladesh Pirojpur Tk 1,195 crore public works embezzlement investigation October 10 2026', 'Recover the original investigation and any official or independent corroborating material.'],
  ['bangladesh-dengue-hospitals', 'Bangladesh hospitals intensive care shortage dengue 95,451 hospitalizations 295 deaths October 10 2026', 'Recover original hospital reporting and official surveillance data where available.'],
  ['ghana-mining-law', 'Ghana revise mining legislation 20 year lease 15 years October 9 2026 Reuters', 'Recover original or independently corroborated reporting about the proposed mining-law revision.'],
  ['ghana-teachers-strike', 'Ghana teachers suspend nationwide strike salary promotion arrears underserved allowance October 9 2026', 'Recover Ghana News Agency or other established Ghanaian reporting and distinguish suspension from final resolution.'],
]

function parseArgs(argv) {
  const options = { start: null, end: null, output: null, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--start') options.start = argv[++index]
    else if (argv[index] === '--end') options.end = argv[++index]
    else if (argv[index] === '--output') options.output = argv[++index]
    else if (argv[index] === '--dry-run') options.dryRun = true
  }
  if (!options.start || !options.end || !options.output) throw new Error('--start, --end and --output are required')
  if (!Number.isFinite(Date.parse(options.start)) || !Number.isFinite(Date.parse(options.end))) throw new Error('start and end must be valid timestamps')
  return options
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

async function search(apiKey, [id, query, objective], options) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, objective, type: 'auto', category: 'news', numResults: 10, moderation: true, excludeDomains: EXCLUDE_DOMAINS, startPublishedDate: options.start, endPublishedDate: options.end }),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status} ${payload?.error || text.slice(0, 300)}`)
  return {
    id, query, objective, requestId: payload?.requestId || null,
    costDollars: Number(payload?.costDollars?.total || 0),
    results: (payload?.results || []).map(result => ({ title: result.title || '', url: normalizeUrl(result.url), publishedAt: result.publishedDate || null, author: result.author || null, image: result.image || null })),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ targetCount: TARGETS.length, estimatedCostDollars: Number((TARGETS.length * 0.007).toFixed(3)), window: { start: options.start, end: options.end }, targets: TARGETS.map(([id, query]) => ({ id, query })) }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  const searches = []
  for (const target of TARGETS) searches.push(await search(apiKey, target, options))
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), provider: 'exa',
    purpose: 'Targeted recovery of important stories absent from or evidence-deficient in the expanded shadow scan.',
    requestedWindow: { start: options.start, end: options.end },
    targetCount: TARGETS.length,
    costDollars: Number(searches.reduce((sum, item) => sum + item.costDollars, 0).toFixed(6)),
    searches,
  }
  await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ targets: report.targetCount, results: searches.reduce((sum, item) => sum + item.results.length, 0), costDollars: report.costDollars }, null, 2)}\n`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
