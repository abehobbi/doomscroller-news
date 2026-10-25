import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'
import { majorEligible, regionMatchesText } from './merge-discovery-candidates.mjs'

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
const PRIORITY_REGIONS = Object.keys(PRIORITY_REGION_MINIMUMS)

const MULTI_EVENT_TITLE = /\b(?:news in brief|news roundup|and other .{0,35} news)\b/i
const HARD_REJECT = /\b(?:daily mail|tourism|travel guide|things to do|event calendar|press release|sponsored|opinion|podcast|newsletter|award ceremony|wins? \d+ international awards?|celebrity|football|soccer|basketball|tickets?|lottery results?|horoscope|weather forecast|stock picks?|coupon|shopping deal|habitat fair|big sales|return to winning ways|go(?:es)? top .{0,60}(?:defeat|season)|first defeat of (?:the )?season)\b|\b(?:property|housing|trade|sales?)\s+(?:expo|fair)\b|\bagreement\b.{0,80}\b(?:hold|holding|host|hosting)\b.{0,80}\b(?:meeting|conference|summit)s?\b|\b(?:fc|sc)\b.{0,80}\b(?:defeat|winning|league|match)\b/i
const GENERIC_PAGE = /\b(?:home|front page|latest news|breaking news|all news|directory|annual report|meeting packet|minutes|agenda|live updates?)\b/i
const WEAK_EVENT = /\b(?:invites?|calls? for|called for|urges?|urged|challenges?|challenged|highlights? (?:the )?need for|emphasi[sz]es? (?:the )?need for|efforts? (?:are )?needed to|must (?:go|move|extend) beyond|plans? to|could|may|set to|expected to|celebrates?|festival to be held|(?:will|to) launch|launches? initiative|cuts? (?:the )?sod|breaks? ground|groundbreaking|shares? thoughts?|reacts? to|commends?|praises?|welcomes?|reaffirms?|showcas(?:e|es|ed|ing)|partner(?:s|ed|ing)? with|weighs? in|misses? court|open for|ready to|vows? to)\b|\bsays?\s+(?:professor|minister|official|expert)\b|\bprof(?:essor|\.)?\s+[A-Z]/i
const CEREMONIAL_EVENT = /\b(?:cuts? (?:the )?sod|breaks? ground|groundbreaking)\b/i
const CEREMONIAL_COMMISSION = /\b(?:commissions?|commissioned|inaugurates?|inaugurated|unveils?|unveiled)\b.{0,70}\b(?:borehole|classroom|school block|mural|statue|plaque|office|facility)\b|\b(?:borehole|classroom|school block|mural|statue|plaque|office|facility)\b.{0,70}\b(?:commissions?|commissioned|inaugurates?|inaugurated|unveils?|unveiled)\b/i
const PUBLICITY_AGREEMENT = /\b(?:signs?|inks?|announces?|forms?|enters?)\b.{0,50}\b(?:partnership|memorandum|mou|cooperation agreement)\b|\bpartners? with\b|\bsigns?\b.{0,60}(?:\b(?:agreement|deal)\b.{0,80}\b(?:project|development|expansion|planned|phase|hub)\b|\b(?:project|development|expansion|planned|phase|hub)\b.{0,40}\b(?:agreement|deal)\b)/i
const PROSPECTIVE_FACILITY = /\b(?:to|will|expected to)\s+open\b.{0,80}\b(?:centre|center|facility|office|campus|hub)\b/i
const STATEMENT_ONLY = /\b(?:calls? for|urges?|reaffirms?|outlines?)\b.{0,100}\b(?:implementation|investment|initiative|plan|policy|support|cooperation|ceasefire|peace|navigation)\b/i
const DELIVERED_CONSEQUENCE = /\b(?:funding (?:approved|released)|loan (?:approved|disbursed)|construction (?:begins|started)|opens? to (?:the )?public|starts? operations?|service begins|acquisition completed|workers? hired|homes? completed)\b/i
const CONCRETE = /\b(?:kills?|dies?|dead|injur(?:y|ed|ies)|arrests?|convicts?|acquits?|bans?|blocks?|halts?|suspends?|overturns?|approves?|rejects?|signs?|strikes?|attacks?|evacuates?|sinks?|sank|sunk|traffick(?:ed|ing)?|layoffs?|displaced|floods?|earthquake|hurricane|outbreaks?|shortage|collapse|closes?|opens?|restores?|discovers?|found|reveals?|reports?|reaches? agreement|cuts?|rises?|falls?|first|record|investigat(?:es?|ion)|lawsuit|protest|sanctions?|election|ceasefire|troops?|war|famine|hunger|food insecurity|malnutrition)\b/i
const HUMAN_TEXTURE = /\b(?:village|community|famil(?:y|ies)|residents?|women|children|youths?|artisans?|farmers?|fishers?|workers?|craft|tradition|harvest|livelihood|neighbou?rhood|small town|Indigenous|tribal|refugee|market|water|wildlife|chimpanzees?|mosquitoes?|mangrove|forest|river|wetland|school|education|housing|tenant|hospital|theatre|portrait|literature|clothing|class|debt|sanitation|poultry|rescue|sailors?|mining|extraction)\b/i
const DISCOVERY_SIGNAL = /\b(?:study|researchers?|scientists?|fossil|archaeolog|paleontolog|species|planet|space|Webb|brain|genome|microbes?|quantum|clock|ancient|excavat|Nature|journal|trial|mice|stars?|galaxy|evolution)\b/i
const COPY_MARKERS = /(?:\|\s*(?:AP News|Reuters|BBC News|CBC News|Al Jazeera)|-Xinhua|Africa Newsroom\s*\/\s*Press release)/i
const WEAK_DOMAINS = [
  'dailymail.com', 'economictimes.indiatimes.com', 'timesofindia.indiatimes.com',
  'boredpanda.com', 'inkl.com', 'techtimes.com', 'newsghana.com.gh', 'newsghana.com',
  'cnnbc.com', 'scienmag.com', 'scibeat.com', 'scitechdaily.com', 'dnyuz.com', 'dainiktrend.com',
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
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 160) throw new Error('--count must be an integer from 1 to 160')
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

function normalizeToken(token) {
  const aliases = new Map([
    ['killed', 'kill'], ['kills', 'kill'], ['killing', 'kill'],
    ['strikes', 'strike'], ['struck', 'strike'],
    ['protests', 'protest'], ['protesters', 'protester'],
    ['sudanese', 'sudan'], ['miners', 'mine'], ['miner', 'mine'],
    ['riyadh', 'saudiarabia'], ['saudi', 'saudiarabia'],
    ['kyiv', 'ukraine'], ['ukrainian', 'ukraine'],
    ['kharkiv', 'ukraine'], ['odesa', 'ukraine'], ['odessa', 'ukraine'], ['dnipro', 'ukraine'],
    ['zelenskyy', 'ukraine'], ['zelensky', 'ukraine'],
    ['moscow', 'russia'], ['putin', 'russia'],
    ['attack', 'strike'], ['attacks', 'strike'], ['attacked', 'strike'],
    ['israeli', 'israel'],
  ])
  if (aliases.has(token)) return aliases.get(token)
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function tokens(value) {
  const preservedAcronyms = new Set(['icc', 'iaea', 'imf', 'nato', 'who'])
  return new Set(cleanTitle(value).toLowerCase().replace(/airstrike/g, 'air strike').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).map(normalizeToken).filter(token => (token.length > 3 || preservedAcronyms.has(token)) && !STOPWORDS.has(token)))
}

function similarity(left, right) {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter(token => b.has(token)).length
  return intersection / Math.min(a.size, b.size)
}

function namedVessels(value) {
  return new Set([...String(value || '').matchAll(/\b(?:m\/?v|ss|ms)\s+([a-z][a-z'-]{3,})\b/gi)].map(match => match[1].toLowerCase()))
}

function domainTier(domain) {
  if (STRONG_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`))) return 'strong'
  if (WEAK_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`))) return 'weak'
  return 'unrated'
}

function laneScore(lane, title) {
  if (lane === 'discovery') return DISCOVERY_SIGNAL.test(title) ? 15 : -12
  if (lane.includes('major')) return CONCRETE.test(title) && majorEligible(title) ? 15 : -30
  return HUMAN_TEXTURE.test(title) ? 14 : 2
}

export function lowConsequenceEvent(value) {
  const title = cleanTitle(value)
  return CEREMONIAL_EVENT.test(title)
    || CEREMONIAL_COMMISSION.test(title)
    || (PROSPECTIVE_FACILITY.test(title) && !DELIVERED_CONSEQUENCE.test(title))
    || (PUBLICITY_AGREEMENT.test(title) && !DELIVERED_CONSEQUENCE.test(title))
    || (STATEMENT_ONLY.test(title) && !DELIVERED_CONSEQUENCE.test(title))
    || (WEAK_EVENT.test(title) && !CONCRETE.test(title) && !DISCOVERY_SIGNAL.test(title))
}

export function scoreCandidate(candidate, reportCreatedAt) {
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
  const lowConsequence = lowConsequenceEvent(title)
  if (lowConsequence) { score -= 50; reasons.push('low-consequence statement, publicity, or prospective framing') }
  else if (WEAK_EVENT.test(title)) { score -= 8; reasons.push('statement, invitation, or prospective framing') }
  if (GENERIC_PAGE.test(title)) { score -= 30; reasons.push('generic or rolling page') }
  if (HARD_REJECT.test(`${title} ${domain}`) || MULTI_EVENT_TITLE.test(title)) { score -= 80; reasons.push('hard editorial rejection') }
  if (COPY_MARKERS.test(candidate.title) && tier !== 'strong') { score -= 4; reasons.push('possible derivative or republished copy') }
  const published = Date.parse(candidate.publishedAt || '')
  const created = Date.parse(reportCreatedAt || '')
  const ageHours = Number.isFinite(published) && Number.isFinite(created) ? Math.max(0, (created - published) / 3_600_000) : null
  if (ageHours !== null) score += ageHours <= 30 ? 5 : ageHours <= 54 ? 2 : 0
  const inferredRegions = PRIORITY_REGIONS.filter(region => regionMatchesText(region, title))
  const priorityRegions = [...new Set([...(candidate.priorityRegions || []), ...candidate.queryIds.map(id => QUERY_REGIONS.get(id)).filter(Boolean), ...inferredRegions].filter(region => regionMatchesText(region, title)))]
  const inferredMajorLane = majorEligible(title) && CONCRETE.test(title) && !lowConsequence
    ? (priorityRegions.length ? 'priority-major' : 'world-major')
    : null
  const normalizedLanes = [...candidate.lanes, inferredMajorLane].filter(Boolean)
    .filter(lane => !lane.includes('major') || majorEligible(title))
    .map(lane => !priorityRegions.length && lane.startsWith('priority-') ? lane.replace('priority-', 'world-')
      : priorityRegions.length && lane === 'world-major' ? 'priority-major' : lane)
  const eligibleLanes = [...new Set(normalizedLanes)]
  const lanes = eligibleLanes.length ? eligibleLanes : [priorityRegions.length ? 'priority-interesting' : 'world-interesting']
  const laneScores = Object.fromEntries(lanes.map(lane => [lane, score + laneScore(lane, title)]))
  return { ...candidate, lanes, priorityRegions, title, domain, sourceTier: tier, ageHours, score, laneScores, reasons, lowConsequence }
}

const GENERIC_CLUSTER_TERMS = new Set([
  'administration', 'attack', 'airport', 'billion', 'candidate', 'case', 'court',
  'government', 'leader', 'lawsuit', 'million', 'minister', 'people', 'president',
  'report', 'state', 'supreme', 'world', 'year',
])
const PLACE_ANCHORS = new Set(['saudiarabia', 'sudan', 'ukraine', 'india', 'bangladesh', 'ghana', 'syria', 'canada', 'nepal', 'gaza', 'lebanon', 'congo', 'israel', 'westbank'])
const EVENT_ANCHORS = new Set(['airport', 'attack', 'ceasefire', 'election', 'flood', 'mine', 'protest', 'strike'])
const ENTITY_ANCHORS = new Set(['icc', 'iaea', 'imf', 'nato', 'who'])
const DISEASE_ANCHORS = new Set(['measle', 'ebola', 'cholera', 'dengue', 'mpox', 'malaria', 'covid', 'influenza', 'polio'])

function namedLocations(value) {
  const normalized = String(value || '').replace(/\b[A-Z][\p{L}']+-(?:occupied|controlled|held)\s+/gu, '')
  const aliases = new Map([
    ['damascus', 'syria'], ['daraa', 'syria'], ['quneitra', 'syria'], ['raqqa', 'syria'],
    ['hebron', 'westbank'], ['jenin', 'westbank'],
  ])
  return [...normalized.matchAll(/\b(?:at|in|near|outside|across|throughout)\s+([A-Z][\p{L}'-]{2,})/gu)]
    .map(match => match[1].toLowerCase())
    .map(location => aliases.get(location) || location)
}

const EXPLICIT_GEOGRAPHIES = [
  ['alaska', /\balaska(?:n)?\b/i], ['britishcolumbia', /\b(?:british columbia|b\.c\.)\b/i],
  ['ontario', /\bontario\b/i], ['quebec', /\bquebec\b/i], ['alberta', /\balberta\b/i],
  ['newmexico', /\bnew mexico\b/i], ['newyork', /\bnew york\b/i], ['california', /\bcalifornia\b/i],
  ['romania', /\bromania(?:n)?\b/i], ['serbia', /\bserbia(?:n)?\b/i], ['poland', /\bpol(?:and|ish)\b/i],
  ['tunisia', /\btunisia(?:n)?\b/i], ['gambia', /\b(?:the )?gambia(?:n)?\b/i],
  ['liechtenstein', /\bliechtenstein\b/i], ['bougainville', /\bbougainville\b/i],
]
const explicitGeographies = value => EXPLICIT_GEOGRAPHIES.filter(([, pattern]) => pattern.test(String(value || ''))).map(([id]) => id)

export function headlinesShareNamedLocationAndEvent(left, right) {
  const locationsA = namedLocations(left.title), locationsB = namedLocations(right.title)
  if (!locationsA.some(location => locationsB.includes(location))) return false
  const a = tokens(left.title), b = tokens(right.title)
  return [...a].some(token => b.has(token) && EVENT_ANCHORS.has(token))
}

export function headlinesExplicitlyConflict(left, right) {
  const a = tokens(left.title), b = tokens(right.title)
  const placesA = [...a].filter(token => PLACE_ANCHORS.has(token))
  const placesB = [...b].filter(token => PLACE_ANCHORS.has(token))
  if (placesA.length && placesB.length && !placesA.some(place => placesB.includes(place))) return true
  const namedPlacesA = namedLocations(left.title), namedPlacesB = namedLocations(right.title)
  if (namedPlacesA.length && namedPlacesB.length && !namedPlacesA.some(place => namedPlacesB.includes(place))) return true
  const explicitA = explicitGeographies(left.title), explicitB = explicitGeographies(right.title)
  if (explicitA.length && explicitB.length && !explicitA.some(place => explicitB.includes(place))) return true
  const diseasesA = [...a].filter(token => DISEASE_ANCHORS.has(token))
  const diseasesB = [...b].filter(token => DISEASE_ANCHORS.has(token))
  if (diseasesA.length && diseasesB.length && !diseasesA.some(disease => diseasesB.includes(disease))) return true
  const numbersA = [...String(left.title || '').matchAll(/\b\d{1,4}\b/g)].map(match => match[0])
  const numbersB = [...String(right.title || '').matchAll(/\b\d{1,4}\b/g)].map(match => match[0])
  const sharedEventAnchors = [...a].filter(token => b.has(token) && EVENT_ANCHORS.has(token)).length
  const bothDescribeCurrencyAmounts = /(?:[$£€]|\b(?:tk|bdt|usd|cad|eur|gbp)\b)/i.test(left.title || '')
    && /(?:[$£€]|\b(?:tk|bdt|usd|cad|eur|gbp)\b)/i.test(right.title || '')
  if (numbersA.length && numbersB.length && !numbersA.some(value => numbersB.includes(value)) && sharedEventAnchors < 2 && !bothDescribeCurrencyAmounts) return true
  return false
}

export function candidatesDescribeSameThread(left, right) {
  if (MULTI_EVENT_TITLE.test(left.title || '') || MULTI_EVENT_TITLE.test(right.title || '')) {
    return cleanTitle(left.title) === cleanTitle(right.title)
  }
  const leftVessels = namedVessels(left.title), rightVessels = namedVessels(right.title)
  if ([...leftVessels].some(name => rightVessels.has(name))) return true
  const a = tokens(left.title), b = tokens(right.title)
  const sharedTokens = [...a].filter(token => b.has(token))
  if (headlinesExplicitlyConflict(left, right)) return false
  const smaller = Math.max(1, Math.min(a.size, b.size))
  const ratio = sharedTokens.length / smaller
  const distinctive = sharedTokens.some(token => token.length >= 6 && !GENERIC_CLUSTER_TERMS.has(token))
  const sharedPlace = sharedTokens.some(token => PLACE_ANCHORS.has(token))
  const sharedEventAnchors = sharedTokens.filter(token => EVENT_ANCHORS.has(token)).length
  const sharedEntity = sharedTokens.some(token => ENTITY_ANCHORS.has(token))
  const sharedSpecificSubject = sharedTokens.some(token => token.length >= 7 && !GENERIC_CLUSTER_TERMS.has(token) && !PLACE_ANCHORS.has(token))
  const leftNumbers = new Set(String(left.title || '').match(/\b\d+\b/g) || [])
  const sharedNonYearNumber = [...(String(right.title || '').match(/\b\d+\b/g) || [])].some(value => leftNumbers.has(value) && !/^20\d{2}$/.test(value))
  return ratio >= 0.55
    || (sharedTokens.length >= 3 && ratio >= 0.33 && distinctive)
    || (sharedPlace && sharedEventAnchors >= 1 && sharedTokens.length >= 3)
    || headlinesShareNamedLocationAndEvent(left, right)
    || (sharedEntity && sharedTokens.length >= 2)
    || (sharedSpecificSubject && sharedNonYearNumber)
}

export function clusterCandidates(scored) {
  const clusters = []
  for (const candidate of [...scored].sort((a, b) => Math.max(...Object.values(b.laneScores)) - Math.max(...Object.values(a.laneScores)))) {
    const match = clusters.find(cluster => candidatesDescribeSameThread(candidate, cluster.representative))
    if (match) match.members.push(candidate)
    else clusters.push({ id: `event-${String(clusters.length + 1).padStart(3, '0')}`, members: [candidate], representative: candidate })
  }
  return clusters.map(cluster => {
    const representative = [...cluster.members].sort((a, b) => Math.max(...Object.values(b.laneScores)) - Math.max(...Object.values(a.laneScores)))[0]
    const lanes = [...new Set(cluster.members.flatMap(item => item.lanes))]
    return { ...cluster, representative, lanes }
  })
}

function bestLaneFor(cluster, counts, phase) {
  const majorLanes = cluster.lanes.filter(lane => lane.includes('major'))
  const eligibleLanes = majorLanes.length ? majorLanes : cluster.lanes
  return eligibleLanes
    .filter(lane => phase === 'open' || counts[lane] < LANE_LIMITS[lane].maximum)
    .map(lane => {
      const limit = LANE_LIMITS[lane]
      const needBonus = phase === 'minimum' && counts[lane] < limit.minimum ? 30 : phase === 'preferred' && counts[lane] < limit.preferred ? 14 : 0
      return { lane, adjusted: (cluster.representative.laneScores[lane] || cluster.representative.score) + needBonus }
    })
    .sort((a, b) => b.adjusted - a.adjusted)[0] || null
}

export function domainDiversityPenalty(existingCount) {
  return Math.min(28, Math.max(0, Number(existingCount || 0) - 1) * 14)
}

export function selectEdition(clusters, count) {
  const selected = []
  const counts = Object.fromEntries(LANE_ORDER.map(lane => [lane, 0]))
  const domainCounts = new Map(), regionCounts = new Map()
  const remaining = clusters.filter(cluster => !cluster.members.every(member => member.lowConsequence) && Math.max(...Object.values(cluster.representative.laneScores)) >= 32)
  const choose = phase => {
    const choices = remaining.flatMap(cluster => {
      const assignment = bestLaneFor(cluster, counts, phase)
      if (!assignment) return []
      const rawDomainPenalty = domainDiversityPenalty(domainCounts.get(cluster.representative.domain) || 0)
      const domainPenalty = assignment.lane.includes('major') ? Math.min(8, rawDomainPenalty) : rawDomainPenalty
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
