import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SOURCES } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/sources.mjs'

const PRIORITY_REGIONS = new Set(['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA'])
const REGION_SIGNALS = {
  Syria: /\b(?:syria|syrian|damascus|aleppo|homs|hama|idlib|latakia|tartous|daraa|deir ez-zor|raqqa|sweida|hasakah)\b/i,
  'Middle East': /\b(?:middle east|iran|iraq|israel|israeli|palestin|gaza|west bank|leban|jordan|yemen|houthi|saudi|riyadh|dhahran|hormuz|qatar|emirat|uae|oman|bahrain|kuwait|turk(?:ey|iye)|syria)\b/i,
  Bangladesh: /\b(?:bangladesh|bangladeshis?|dhaka|chattogram|chittagong|sylhet|rajshahi|khulna|barisal|rangpur|mymensingh|mongla|padma|bnp|awami league)\b/i,
  Ghana: /\b(?:ghana|ghanaian|accra|tema|kumasi|tamale|takoradi|cape coast|ashanti|bawumia|mahama)\b/i,
  Canada: /(?:\b(?:canada|canadian|ontario|quebec|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|british columbia|yukon|nunavut|toronto|torontonians?|durham|montreal|vancouver|ottawa|calgary|edmonton)\b|\bb\.c\.(?=\s|$|[,;:]))/i,
  GTA: /\b(?:greater toronto|gta|toronto|torontonians?|durham|mississauga|brampton|markham|vaughan|scarborough|etobicoke|pickering|ajax|oshawa|oakville|burlington)\b/i,
}
const REGION_PLACE_SIGNALS = {
  Syria: /\b(?:syria|damascus|aleppo|homs|hama|idlib|latakia|tartous|daraa|deir ez-zor|raqqa|sweida|hasakah)\b/i,
  'Middle East': /\b(?:middle east|iran|iraq|israel|palestin|gaza|west bank|lebanon|jordan|yemen|riyadh|dhahran|hormuz|saudi arabia|qatar|united arab emirates|uae|dubai|oman|bahrain|kuwait|turk(?:ey|iye))\b/i,
  Bangladesh: /\b(?:bangladesh|dhaka|chattogram|chittagong|sylhet|rajshahi|khulna|barisal|rangpur|mymensingh|mongla|padma|bnp|awami league)\b/i,
  Ghana: /\b(?:ghana|accra|tema|kumasi|tamale|takoradi|cape coast|ashanti|bawumia|mahama)\b/i,
  Canada: /(?:\b(?:canada|ontario|quebec|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|british columbia|yukon|nunavut|toronto|torontonians?|durham|montreal|vancouver|ottawa|calgary|edmonton)\b|\bb\.c\.(?=\s|$|[,;:]))/i,
  GTA: /\b(?:greater toronto|gta|toronto|torontonians?|durham|mississauga|brampton|markham|vaughan|scarborough|etobicoke|pickering|ajax|oshawa|oakville|burlington)\b/i,
}
const NATIONALITY_PERSON_SIGNALS = {
  Syria: /\bsyrian(?:\s+[a-z0-9-]+){0,2}\s+(?:engineers?|sailors?|workers?|employees?|residents?|tourists?|students?|athletes?|actors?|singers?|doctors?|nurses?|professors?|researchers?|journalists?|citizens?|nationals?|men|women)\b/i,
  'Middle East': /\b(?:iranian|iraqi|israeli|palestinian|lebanese|jordanian|yemeni|saudi|qatari|emirati|omani|bahraini|kuwaiti|turkish)(?:\s+[a-z0-9-]+){0,2}\s+(?:engineers?|sailors?|workers?|employees?|residents?|tourists?|students?|athletes?|actors?|singers?|doctors?|nurses?|professors?|researchers?|journalists?|citizens?|nationals?|men|women)\b/i,
  Bangladesh: /\bbangladeshis?(?:\s+[a-z0-9-]+){0,2}\s+(?:engineers?|sailors?|workers?|jobseekers?|employees?|residents?|tourists?|students?|athletes?|actors?|singers?|doctors?|nurses?|professors?|researchers?|journalists?|citizens?|nationals?|men|women)\b/i,
  Ghana: /\bghanaian(?:\s+[a-z0-9-]+){0,2}\s+(?:engineers?|sailors?|workers?|employees?|residents?|tourists?|students?|athletes?|actors?|singers?|doctors?|nurses?|professors?|researchers?|journalists?|citizens?|nationals?|men|women)\b/i,
  Canada: /\bcanadian(?:\s+[a-z0-9-]+){0,2}\s+(?:engineers?|sailors?|workers?|employees?|residents?|tourists?|students?|athletes?|actors?|singers?|doctors?|nurses?|professors?|researchers?|journalists?|citizens?|nationals?|men|women)\b/i,
}
const POPULATION_CENTRAL_HARM = /\b(?:traffick(?:ed|ing)?|forcibly recruit(?:ed|ing)?|recruit(?:ed|ing)? into (?:a |the )?(?:war|military))\b/i
const MAJOR_SIGNAL = /\b(?:kills?|dead|deaths?|casualt(?:y|ies)|war|invasion|troops?|ceasefire|sanctions?|elections?|government|parliament|court|law|regulations?|inflation|unemployment|layoffs?|strikes?|sinks?|sank|sunk|outbreaks?|epidemic|pandemic|public health|traffick(?:ed|ing)?|displaced|state of emergency|earthquake|hurricane|typhoon|floods?|drought|corruption|embezzlement|billion|million|nationwide|constitutional|military)\b/i
const LOW_SCOPE_MAJOR = /\b(?:bedbugs?|flight (?:cancelled|canceled|grounded)|wildlife park|shares? rise|takeover talks|reunited|fundraising walk|(?:pile of )?dead (?:[a-z-]+\s+){0,2}(?:geese|birds?|fish|animals?))\b/i
const ANALYSIS_ONLY_MAJOR = /\b(?:whether|dilemma|what if|analysis|explainer)\b|\bnext war could\b/i
const SPECULATIVE_MAJOR = /\b(?:could|might|may|potential|scenario)\b/i
const REPORTED_MAJOR_ACTION = /\b(?:kills?|dies?|dead|injur(?:ed|ies)|arrests?|convicts?|acquits?|bans?|blocks?|halts?|suspends?|overturns?|approves?|rejects?|signs?|strikes?|attacks?|evacuates?|declares?|announces?|unveils?|adopts?|orders?|deploys?|launches?|resigns?|collapses?|closes?|opens?|restores?|releases?|discovers?|reveals?|reports?|reaches? agreement|cuts?|rises?|falls?|investigat(?:es?|ion)|lawsuit|protest|sanctions?|election|ceasefire)\b/i
const SOURCE_REGIONS = SOURCES.map(source => {
  try { return { domain: new URL(source.sourceUrl).hostname.replace(/^www\./, ''), regions: source.coverage.filter(region => PRIORITY_REGIONS.has(region)) } }
  catch { return { domain: '', regions: [] } }
}).filter(source => source.domain && source.regions.length)

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|traffic_source)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

export function regionMatchesText(region, value) {
  const text = String(value || '')
  if (!REGION_SIGNALS[region]?.test(text)) return false
  if (REGION_PLACE_SIGNALS[region]?.test(text)) return true
  if (NATIONALITY_PERSON_SIGNALS[region]?.test(text) && POPULATION_CENTRAL_HARM.test(text)) return true
  return !NATIONALITY_PERSON_SIGNALS[region]?.test(text)
}

export function majorEligible(value) {
  const text = String(value || '')
  return MAJOR_SIGNAL.test(text) && !LOW_SCOPE_MAJOR.test(text) && !ANALYSIS_ONLY_MAJOR.test(text) && (!SPECULATIVE_MAJOR.test(text) || REPORTED_MAJOR_ACTION.test(text))
}

function feedLanes(item, verifiedRegions = null) {
  const parts = item.event?.scoreParts || {}
  const regions = verifiedRegions || item.event?.regions || []
  const priority = regions.some(region => PRIORITY_REGIONS.has(region))
  const lanes = []
  if ((parts.discovery || 0) >= 8) lanes.push('discovery')
  const concreteHeadlineAction = (item.event?.primary?.signals?.headlineAction || []).length > 0
  if (((parts.consequence || 0) >= 8 || ((parts.importance || 0) >= 24 && concreteHeadlineAction)) && majorEligible(item.event?.primary?.title)) lanes.push(priority ? 'priority-major' : 'world-major')
  if ((parts.interestingness || 0) > 0 || (parts.localTexture || 0) > 0 || !lanes.length) lanes.push(priority ? 'priority-interesting' : 'world-interesting')
  return [...new Set(lanes)]
}

export function sourceCandidate(item, position = 1) {
  const article = item.event.primary
  const url = canonicalUrl(article.url)
  const geographicText = `${article.title || ''} ${article.description || ''}`
  const regions = (item.event.regions || []).filter(region => PRIORITY_REGIONS.has(region) && regionMatchesText(region, geographicText))
  const lanes = feedLanes(item, regions)
  return {
    title: article.title,
    url,
    publishedAt: article.sourceUpdatedAt || article.publishedAt || null,
    author: null,
    image: item.image?.url || article.imageUrl || null,
    discoveries: [{ lane: lanes[0], region: regions[0] || null, queryId: `publisher-feed:${article.provenance?.feedId || article.sourceId}`, position }],
    lanes,
    priorityRegions: regions,
    queryIds: [`publisher-feed:${article.provenance?.feedId || article.sourceId}`],
    bestPosition: position,
    discoverySources: ['publisher-feed'],
  }
}

function combine(existing, incoming) {
  return {
    ...existing,
    title: existing.title || incoming.title,
    publishedAt: [existing.publishedAt, incoming.publishedAt].filter(Boolean).sort().at(-1) || null,
    image: existing.image || incoming.image,
    discoveries: [...(existing.discoveries || []), ...(incoming.discoveries || [])],
    lanes: [...new Set([...(existing.lanes || []), ...(incoming.lanes || [])])],
    priorityRegions: [...new Set([...(existing.priorityRegions || []), ...(incoming.priorityRegions || [])])],
    queryIds: [...new Set([...(existing.queryIds || []), ...(incoming.queryIds || [])])],
    bestPosition: Math.min(existing.bestPosition || 999, incoming.bestPosition || 999),
    discoverySources: [...new Set([...(existing.discoverySources || ['exa']), ...(incoming.discoverySources || [])])],
  }
}

export function mergeDiscoveryCandidates(exaInput, sourceBatch) {
  const exaReports = Array.isArray(exaInput) ? exaInput : [exaInput]
  const byUrl = new Map()
  for (const item of exaReports.flatMap(report => report.candidates || [])) {
    const url = canonicalUrl(item.url)
    let domain = ''
    try { domain = new URL(url).hostname.replace(/^www\./, '') } catch {}
    const registryRegions = SOURCE_REGIONS.filter(source => domain === source.domain || domain.endsWith(`.${source.domain}`)).flatMap(source => source.regions)
    const priorityRegions = [...new Set([...(item.priorityRegions || []), ...registryRegions].filter(region => regionMatchesText(region, item.title)))]
    const lanes = [...new Set([
      ...(item.lanes || []),
      ...(priorityRegions.length && item.lanes?.includes('world-interesting') ? ['priority-interesting'] : []),
      ...(priorityRegions.length && item.lanes?.includes('world-major') ? ['priority-major'] : []),
    ])]
    const normalized = { ...item, url, lanes, priorityRegions, discoverySources: ['exa'] }
    const existing = byUrl.get(normalized.url)
    byUrl.set(normalized.url, existing ? combine(existing, normalized) : normalized)
  }
  // Publisher headlines remain discovery leads even when immediate article
  // extraction fails. The downstream verifier and bounded repair pass decide
  // whether adequate evidence exists; discovery must not silently erase them.
  const sourceItems = sourceBatch.discoveryCandidates || sourceBatch.candidates || sourceBatch.selected || []
  for (const [index, item] of sourceItems.entries()) {
    const normalized = sourceCandidate(item, index + 1)
    const existing = byUrl.get(normalized.url)
    byUrl.set(normalized.url, existing ? combine(existing, normalized) : normalized)
  }
  const candidates = [...byUrl.values()]
  const exaCandidateCount = exaReports.reduce((sum, report) => sum + (report.candidates || []).length, 0)
  const windowStarts = exaReports.map(report => report.requestedWindow?.start).filter(Boolean).sort()
  const windowEnds = exaReports.map(report => report.requestedWindow?.end).filter(Boolean).sort()
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    provider: 'exa-plus-publisher-feeds',
    requestedWindow: { start: windowStarts[0] || null, end: windowEnds.at(-1) || null },
    queryCount: exaReports.reduce((sum, report) => sum + Number(report.queryCount || 0), 0),
    costDollars: Number(exaReports.reduce((sum, report) => sum + Number(report.costDollars || 0), 0).toFixed(6)),
    rawResultCount: exaReports.reduce((sum, report) => sum + Number(report.rawResultCount || 0), 0) + Number(sourceBatch.counts?.freshArticles || 0),
    uniqueCandidateCount: candidates.length,
    inputCounts: {
      exa: exaCandidateCount,
      publisherFeeds: sourceItems.length,
      mergedByCanonicalUrl: exaCandidateCount + sourceItems.length - candidates.length,
    },
    candidates,
  }
}

async function main() {
  const exaInputs = [], sourceIndex = process.argv.indexOf('--source'), outputIndex = process.argv.indexOf('--output')
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === '--exa') exaInputs.push(process.argv[index + 1])
  if (!exaInputs.length || sourceIndex < 0 || outputIndex < 0) throw new Error('one or more --exa values, --source and --output are required')
  const [exaReports, sourceBatch] = await Promise.all([
    Promise.all(exaInputs.map(input => fs.readFile(input, 'utf8').then(JSON.parse))),
    fs.readFile(process.argv[sourceIndex + 1], 'utf8').then(JSON.parse),
  ])
  const report = mergeDiscoveryCandidates(exaReports, sourceBatch)
  const output = path.resolve(process.argv[outputIndex + 1])
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ...report.inputCounts, uniqueCandidates: report.uniqueCandidateCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
