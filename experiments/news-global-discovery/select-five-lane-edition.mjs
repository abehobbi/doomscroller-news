import fs from 'node:fs/promises'
import path from 'node:path'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'

const STOPWORDS = new Set('a an and are as at be by for from has have how in into is it its of on or that the their this to was were what when where who why will with says said'.split(' '))
const LANE_ORDER = ['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']
const LANE_LABELS = {
  'world-interesting': 'Interesting world',
  'priority-interesting': 'Interesting priority region',
  'world-major': 'Major world',
  'priority-major': 'Major priority region',
  discovery: 'Discovery',
}
const LANE_LIMITS = {
  'world-interesting': { minimum: 10, preferred: 15, maximum: 20 },
  'priority-interesting': { minimum: 6, preferred: 10, maximum: 15 },
  'world-major': { minimum: 10, preferred: 12, maximum: 15 },
  'priority-major': { minimum: 8, preferred: 12, maximum: 15 },
  discovery: { minimum: 4, preferred: 6, maximum: 8 },
}
const QUERY_REGIONS = new Map(FIVE_LANE_QUERIES.map(query => [query.id, query.region]).filter(([, region]) => region))
const PRIORITY_REGION_MINIMUMS = { Syria: 2, 'Middle East': 2, Bangladesh: 2, Ghana: 2, Canada: 2, GTA: 1 }

const HARD_REJECT = /\b(?:daily mail|tourism|travel guide|things to do|event calendar|press release|sponsored|opinion|podcast|newsletter|award ceremony|celebrity|football|soccer|basketball|tickets?|lottery results?|horoscope|weather forecast|stock picks?|coupon|shopping deal)\b/i
const GENERIC_PAGE = /\b(?:home|front page|latest news|breaking news|all news|directory|annual report|meeting packet|minutes|agenda|live updates?)\b/i
const WEAK_EVENT = /\b(?:invites?|calls? for|urges?|plans? to|could|may|set to|expected to|celebrates?|festival to be held|launches? initiative|shares? thoughts?|reacts? to)\b/i
const CONCRETE = /\b(?:kills?|dies?|dead|injur(?:y|ed|ies)|arrests?|convicts?|acquits?|bans?|blocks?|halts?|suspends?|overturns?|approves?|rejects?|signs?|strikes?|attacks?|evacuates?|floods?|earthquake|hurricane|outbreak|shortage|collapse|closes?|opens?|restores?|discovers?|found|reveals?|reports?|reaches? agreement|cuts?|rises?|falls?|first|record|investigat(?:es?|ion)|lawsuit|protest|sanctions?|election|ceasefire|troops?|war)\b/i
const HUMAN_TEXTURE = /\b(?:village|community|famil(?:y|ies)|residents?|women|children|youths?|artisans?|farmers?|fishers?|workers?|craft|tradition|harvest|livelihood|neighbou?rhood|small town|Indigenous|tribal|refugee|market|water|wildlife|mangrove|forest|river|wetland|school|housing|tenant|hospital)\b/i
const DISCOVERY_SIGNAL = /\b(?:study|researchers?|scientists?|fossil|archaeolog|paleontolog|species|planet|space|Webb|brain|genome|microbes?|quantum|clock|ancient|excavat|Nature|journal|trial|mice|stars?|galaxy|evolution)\b/i
const COPY_MARKERS = /(?:\|\s*(?:AP News|Reuters|BBC News|CBC News|Al Jazeera)|-Xinhua|Africa Newsroom\s*\/\s*Press release)/i
const WEAK_DOMAINS = [
  'dailymail.com', 'economictimes.indiatimes.com', 'timesofindia.indiatimes.com',
  'boredpanda.com', 'inkl.com', 'techtimes.com', 'newsghana.com.gh', 'newsghana.com',
]
const STRONG_DOMAINS = [
  'apnews.com', 'reuters.com', 'bbc.com', 'bbc.co.uk', 'cbc.ca', 'aljazeera.com',
  'theguardian.com', 'globalnews.ca', 'nature.com', 'science.org', 'npr.org',
  'hrw.org', 'groundup.org.za', 'pulitzercenter.org', 'mongabay.com', 'financialtimes.com',
  'thedailystar.net', 'tbsnews.net', 'dhakatribune.com', 'myjoyonline.com', 'citinewsroom.com',
]

function parseArgs(argv) {
  const options = { input: null, outputDir: null, count: 65 }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--count') options.count = Number(argv[++index])
  }
  if (!options.input || !options.outputDir) throw new Error('--input and --output-dir are required')
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 65) throw new Error('--count must be an integer from 1 to 65')
  return options
}

function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/^\(Hello Africa\)\s*/i, '')
    .replace(/\s+\|\s+(?:AP News|Reuters|BBC News|CBC News|Al Jazeera|CNN|The Guardian).*$/i, '')
    .replace(/\s+[–—-]\s+(?:BBC News|CBC News|ABC News|Globalnews\.ca|The Mainichi|The Seattle Times).*$/i, '')
    .replace(/-Xinhua$/i, '')
    .trim()
}

function tokens(value) {
  return new Set(cleanTitle(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => token.length > 3 && !STOPWORDS.has(token)))
}

function similarity(left, right) {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter(token => b.has(token)).length
  return intersection / Math.min(a.size, b.size)
}

function domainTier(domain) {
  if (STRONG_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`))) return 'strong'
  if (WEAK_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`))) return 'weak'
  return 'unrated'
}

function laneScore(lane, title) {
  if (lane === 'discovery') return DISCOVERY_SIGNAL.test(title) ? 15 : -12
  if (lane.includes('major')) return CONCRETE.test(title) ? 15 : -6
  return HUMAN_TEXTURE.test(title) ? 14 : 2
}

function scoreCandidate(candidate, reportCreatedAt) {
  const title = cleanTitle(candidate.title)
  const domain = domainOf(candidate.url)
  const tier = domainTier(domain)
  const reasons = []
  let score = 42
  if (tier === 'strong') { score += 13; reasons.push('established or specialist source') }
  if (tier === 'weak') { score -= 18; reasons.push('weak or derivative source') }
  if (CONCRETE.test(title)) { score += 8; reasons.push('concrete development') }
  if (HUMAN_TEXTURE.test(title)) { score += 8; reasons.push('human or place-specific core') }
  if (DISCOVERY_SIGNAL.test(title)) { score += 5; reasons.push('specific research or discovery signal') }
  if (/\d/.test(title)) score += 2
  if (candidate.queryIds.length > 1) { score += Math.min(10, (candidate.queryIds.length - 1) * 3); reasons.push('retrieved independently by multiple queries') }
  score += Math.max(0, 7 - candidate.bestPosition)
  if (candidate.image) score += 3
  else { score -= 3; reasons.push('missing provider image') }
  if (WEAK_EVENT.test(title)) { score -= 8; reasons.push('statement, invitation, or prospective framing') }
  if (GENERIC_PAGE.test(title)) { score -= 30; reasons.push('generic or rolling page') }
  if (HARD_REJECT.test(`${title} ${domain}`)) { score -= 80; reasons.push('hard editorial rejection') }
  if (COPY_MARKERS.test(candidate.title) && tier !== 'strong') { score -= 4; reasons.push('possible derivative or republished copy') }
  const published = Date.parse(candidate.publishedAt || '')
  const created = Date.parse(reportCreatedAt || '')
  const ageHours = Number.isFinite(published) && Number.isFinite(created) ? Math.max(0, (created - published) / 3_600_000) : null
  if (ageHours !== null) score += ageHours <= 30 ? 5 : ageHours <= 54 ? 2 : 0
  const laneScores = Object.fromEntries(candidate.lanes.map(lane => [lane, score + laneScore(lane, title)]))
  const priorityRegions = [...new Set([...(candidate.priorityRegions || []), ...candidate.queryIds.map(id => QUERY_REGIONS.get(id)).filter(Boolean)])]
  return { ...candidate, priorityRegions, title, domain, sourceTier: tier, ageHours, score, laneScores, reasons }
}

function clusterCandidates(scored) {
  const clusters = []
  for (const candidate of [...scored].sort((a, b) => Math.max(...Object.values(b.laneScores)) - Math.max(...Object.values(a.laneScores)))) {
    const match = clusters.find(cluster => cluster.members.some(member => similarity(candidate.title, member.title) >= 0.62))
    if (match) match.members.push(candidate)
    else clusters.push({ id: `event-${String(clusters.length + 1).padStart(3, '0')}`, members: [candidate] })
  }
  return clusters.map(cluster => {
    const representative = [...cluster.members].sort((a, b) => Math.max(...Object.values(b.laneScores)) - Math.max(...Object.values(a.laneScores)))[0]
    const lanes = [...new Set(cluster.members.flatMap(item => item.lanes))]
    return { ...cluster, representative, lanes }
  })
}

function bestLaneFor(cluster, counts, phase) {
  return cluster.lanes
    .filter(lane => counts[lane] < LANE_LIMITS[lane].maximum)
    .map(lane => {
      const limit = LANE_LIMITS[lane]
      const needBonus = phase === 'minimum' && counts[lane] < limit.minimum ? 30 : phase === 'preferred' && counts[lane] < limit.preferred ? 14 : 0
      return { lane, adjusted: (cluster.representative.laneScores[lane] || cluster.representative.score) + needBonus }
    })
    .sort((a, b) => b.adjusted - a.adjusted)[0] || null
}

function selectEdition(clusters, count) {
  const selected = []
  const counts = Object.fromEntries(LANE_ORDER.map(lane => [lane, 0]))
  const domainCounts = new Map(), regionCounts = new Map()
  const remaining = clusters.filter(cluster => Math.max(...Object.values(cluster.representative.laneScores)) >= 32)
  const choose = phase => {
    const choices = remaining.flatMap(cluster => {
      const assignment = bestLaneFor(cluster, counts, phase)
      if (!assignment) return []
      const domainPenalty = Math.max(0, (domainCounts.get(cluster.representative.domain) || 0) - 1) * 14
      const regions = cluster.members.flatMap(member => member.priorityRegions || [])
      const largestRegionGap = Math.max(0, ...regions.map(region => Math.max(0, (PRIORITY_REGION_MINIMUMS[region] || 0) - (regionCounts.get(region) || 0))))
      const regionBonus = assignment.lane.startsWith('priority-') ? largestRegionGap * 14 : 0
      const agePenalty = cluster.representative.ageHours !== null && cluster.representative.ageHours > 72 ? 30 : 0
      return [{ cluster, lane: assignment.lane, adjusted: assignment.adjusted + regionBonus - domainPenalty - agePenalty }]
    }).sort((a, b) => b.adjusted - a.adjusted)
    const choice = choices[0]
    if (!choice) return false
    selected.push({ ...choice.cluster, assignedLane: choice.lane, adjustedScore: choice.adjusted })
    counts[choice.lane] += 1
    domainCounts.set(choice.cluster.representative.domain, (domainCounts.get(choice.cluster.representative.domain) || 0) + 1)
    for (const region of choice.cluster.members.flatMap(member => member.priorityRegions || [])) regionCounts.set(region, (regionCounts.get(region) || 0) + 1)
    remaining.splice(remaining.indexOf(choice.cluster), 1)
    return true
  }
  for (const phase of ['minimum', 'preferred', 'open']) {
    while (selected.length < count) {
      if (phase === 'minimum' && LANE_ORDER.every(lane => counts[lane] >= LANE_LIMITS[lane].minimum)) break
      if (phase === 'preferred' && LANE_ORDER.every(lane => counts[lane] >= LANE_LIMITS[lane].preferred)) break
      if (!choose(phase)) break
      if (phase === 'open' && Math.max(...selected.slice(-1).map(item => item.adjustedScore)) < 34) break
    }
  }
  return { selected, counts, regionCounts: Object.fromEntries(regionCounts), remaining }
}

function renderMarkdown(report, selection) {
  const lines = [
    '# Five-lane mock daily edition', '',
    `Scout completed: ${report.createdAt}`, '',
    `Search window: ${report.requestedWindow.start} to ${report.requestedWindow.end}`, '',
    `Exa cost: $${report.costDollars.toFixed(3)} for ${report.queryCount} searches`, '',
    `Selected ${selection.selected.length} event candidates from ${report.uniqueCandidateCount} unique URLs. This is an editorial-selection diagnostic, not generated final card copy.`, '',
    '## Mix', '',
  ]
  for (const lane of LANE_ORDER) lines.push(`- ${LANE_LABELS[lane]}: ${selection.counts[lane]}`)
  lines.push('', '## Candidates', '')
  selection.selected.forEach((cluster, index) => {
    const item = cluster.representative
    const sourceCount = new Set(cluster.members.map(member => member.domain)).size
    lines.push(
      `### ${index + 1}. ${item.title}`,
      '',
      `- Lane: ${LANE_LABELS[cluster.assignedLane]}`,
      `- Source: ${item.domain}`,
      `- Published: ${item.publishedAt || 'unverified'}`,
      `- Image returned: ${item.image ? 'yes' : 'no'}`,
      `- Cluster: ${cluster.members.length} URL${cluster.members.length === 1 ? '' : 's'} across ${sourceCount} publisher${sourceCount === 1 ? '' : 's'}`,
      `- Link: ${item.url}`,
      '',
    )
  })
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await fs.readFile(options.input, 'utf8'))
  const scored = report.candidates.map(candidate => scoreCandidate(candidate, report.createdAt))
  const clusters = clusterCandidates(scored)
  const selection = selectEdition(clusters, options.count)
  const output = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceReport: options.input,
    sourceCreatedAt: report.createdAt,
    inputCandidates: scored.length,
    eventClusters: clusters.length,
    selectedCount: selection.selected.length,
    laneCounts: selection.counts,
    priorityRegionCounts: selection.regionCounts,
    priorityRegionMinimums: PRIORITY_REGION_MINIMUMS,
    laneLimits: LANE_LIMITS,
    selections: selection.selected,
    rejected: selection.remaining,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'MOCK_EDITION.md'), renderMarkdown(report, selection), 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'ANSWER_KEY.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ inputCandidates: scored.length, eventClusters: clusters.length, selected: selection.selected.length, laneCounts: selection.counts }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
