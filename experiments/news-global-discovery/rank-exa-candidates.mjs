import fs from 'node:fs/promises'
import path from 'node:path'

const STOPWORDS = new Set('a an and are as at be by for from has have how in into is it its of on or that the their this to was were what when where who why will with'.split(' '))
const HARD_REJECT = /\b(?:daily mail|tourism|travel guide|things to do|event calendar|press release|sponsored|opinion|podcast|newsletter|award ceremony|celebrity|football|soccer|basketball|tickets?|candidates? share priorities)\b/i
const WEAK_EVENT = /\b(?:announces?|invites?|calls? for|urges?|plans? to|could|may|set to|expected to|celebrates?|festival to be held|launches? initiative)\b/i
const CONCRETE_CHANGE = /\b(?:after \d+ years?|first time|first |returns?|returned|revives?|revival|restores?|restoration|transformed|converts?|turns? .* into|protects?|discovers?|found|protest|blocks?|refuses?|survives?|keeps? .* alive|struggle|shortage|fails?|lost|gains?|creates?|builds?|replaces?|reopens?|bans?|preserves?|threatened|extinct|endangered)\b/i
const HUMAN_TEXTURE = /\b(?:village|community|famil(?:y|ies)|residents?|women|youths?|artisans?|farmers?|fishers?|weavers?|craft|tradition|harvest|livelihood|ordinary life|neighbou?rhood|small town|local|Indigenous|tribal|refugee|market|water|wildlife|mangrove|forest|river|wetland|soil)\b/i
const GENERIC_PAGE = /\b(?:home|front page|latest news|breaking news|all news|directory|annual report|security report|meeting packet|minutes|agenda)\b/i

const STRONG_DOMAINS = [
  'abc.net.au', 'bbc.com', 'bbc.co.uk', 'cbc.ca', 'civilnet.am', 'ewn.co.za',
  'frontliner.ua', 'groundup.org.za', 'indianexpress.com', 'mainichi.jp',
  'malaysiakini.com', 'mongabay.com', 'newsroom.gy', 'npr.org', 'pulitzercenter.org',
  'rappler.com', 'straitstimes.com', 'theborneopost.com', 'theguardian.com',
  'thenationalnews.com', 'tribuneindia.com', 'vietnamnet.vn',
]
const WEAK_DOMAINS = [
  '7globe.in', 'dailymail.com', 'economictimes.indiatimes.com', 'fashiontimes.co.uk',
  'boredpanda.com', 'examinerlive.co.uk', 'gikutaku.com', 'happyreaddaily.com', 'inkl.com',
  'londonchannelnews.com', 'mgronline.com', 'myzimbabwe.co.zw', 'orissasambad.com', 'seasia.co', 'techtimes.com',
  'timesofindia.indiatimes.com',
]

function parseArgs(argv) {
  const options = { input: null, outputDir: null, count: 20 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') options.input = argv[++i]
    else if (argv[i] === '--output-dir') options.outputDir = argv[++i]
    else if (argv[i] === '--count') options.count = Number(argv[++i])
  }
  if (!options.input || !options.outputDir) throw new Error('--input and --output-dir are required')
  if (!Number.isInteger(options.count) || options.count < 1) throw new Error('--count must be a positive integer')
  return options
}

function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

function tokens(value) {
  return new Set(String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => token.length > 3 && !STOPWORDS.has(token)))
}

function similarity(left, right) {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  const shared = [...a].filter(token => b.has(token)).length
  return shared / Math.min(a.size, b.size)
}

function sourceTier(domain) {
  if (STRONG_DOMAINS.some(value => domain === value || domain.endsWith(`.${value}`))) return 'strong'
  if (WEAK_DOMAINS.some(value => domain === value || domain.endsWith(`.${value}`))) return 'weak'
  return 'unrated'
}

function scoreCandidate(candidate, index) {
  const title = String(candidate.title || '').trim()
  const domain = domainOf(candidate.url)
  const tier = sourceTier(domain)
  const reasons = []
  let score = 40
  if (tier === 'strong') { score += 16; reasons.push('known stronger publisher') }
  if (tier === 'weak') { score -= 22; reasons.push('weak or derivative publisher') }
  if (CONCRETE_CHANGE.test(title)) { score += 15; reasons.push('concrete development') }
  if (HUMAN_TEXTURE.test(title)) { score += 13; reasons.push('place-specific human texture') }
  if (/\d/.test(title)) { score += 3; reasons.push('specific numerical detail') }
  if (candidate.foundBy?.length > 1) { score += 5; reasons.push('found by multiple search families') }
  if (candidate.foundBy?.includes('ordinary-life')) { score += 15; reasons.push('substantive everyday-life reporting') }
  if (candidate.foundBy?.includes('living-traditions')) { score += 6; reasons.push('distinctive living tradition') }
  if (candidate.foundBy?.includes('local-experiment')) { score += 6; reasons.push('distinctive local experiment') }
  if (WEAK_EVENT.test(title)) { score -= 7; reasons.push('weaker announcement or prospective framing') }
  if (GENERIC_PAGE.test(title)) { score -= 30; reasons.push('generic page rather than distinct event') }
  if (HARD_REJECT.test(`${title} ${domain}`)) { score -= 60; reasons.push('hard editorial rejection') }
  score += Math.max(0, 5 - Math.floor(index / 16))
  return { ...candidate, domain, sourceTier: tier, baseOrder: index + 1, score, reasons }
}

function clusterCandidates(scored) {
  const clusters = []
  for (const candidate of [...scored].sort((a, b) => b.score - a.score)) {
    const cluster = clusters.find(value => value.some(other => similarity(candidate.title, other.title) >= 0.58))
    if (cluster) cluster.push(candidate)
    else clusters.push([candidate])
  }
  return clusters.map((members, index) => ({
    id: `cluster-${String(index + 1).padStart(3, '0')}`,
    members,
    representative: members[0],
  }))
}

function selectDiverse(clusters, count) {
  const remaining = clusters.filter(cluster => cluster.representative.score >= 30)
  const selected = [], familyCounts = new Map(), domainCounts = new Map()
  while (remaining.length && selected.length < count) {
    const ranked = remaining.map(cluster => {
      const item = cluster.representative
      const familyPenalty = Math.min(...(item.foundBy || []).map(family => (familyCounts.get(family) || 0) * 7), 0)
      const domainPenalty = (domainCounts.get(item.domain) || 0) * 18
      const multiFamilyBonus = Math.max(0, (item.foundBy?.length || 1) - 1) * 4
      return { cluster, adjusted: item.score + multiFamilyBonus - familyPenalty - domainPenalty }
    }).sort((a, b) => b.adjusted - a.adjusted || b.cluster.representative.score - a.cluster.representative.score)
    const choice = ranked[0]
    selected.push({ ...choice.cluster, adjustedScore: choice.adjusted })
    remaining.splice(remaining.indexOf(choice.cluster), 1)
    for (const family of choice.cluster.representative.foundBy || []) familyCounts.set(family, (familyCounts.get(family) || 0) + 1)
    domainCounts.set(choice.cluster.representative.domain, (domainCounts.get(choice.cluster.representative.domain) || 0) + 1)
  }
  return selected
}

function deterministicBlindOrder(values) {
  return [...values].sort((a, b) => {
    const left = [...a.representative.title].reduce((sum, char, index) => sum + char.codePointAt(0) * (index + 11), 0)
    const right = [...b.representative.title].reduce((sum, char, index) => sum + char.codePointAt(0) * (index + 11), 0)
    return left - right
  })
}

function blindTitle(value) {
  return String(value || '')
    .replace(/^\(Hello Africa\)\s*/i, '')
    .replace(/\s+\|\s+[^|]+$/i, '')
    .replace(/\s+[–—]\s+(?:MGR Online International).*$/i, '')
    .replace(/\s+-\s+(?:ABC News|BBC News|CBC News|Hambleton Today|The Mainichi|The Straits Times|The Week|Malaysiakini|News Room Guyana).*$/i, '')
    .replace(/-Xinhua$/i, '')
    .trim()
}

function blindMarkdown(selected, createdAt) {
  const ordered = deterministicBlindOrder(selected)
  const lines = [
    '# Blind worldwide-discovery shortlist', '',
    `Generated from the isolated Exa candidate batch (${createdAt}).`, '',
    'Judge the story idea, not its position. Source names, URLs, search families, and algorithm scores are hidden here and retained separately in the answer key.', '',
    'For each item, mark **Keep**, **Maybe**, or **Reject**, and add whatever reaction comes naturally.', '',
  ]
  ordered.forEach((cluster, index) => {
    lines.push(`## ${index + 1}. ${blindTitle(cluster.representative.title)}`, '', '- Verdict:', '- Comment:', '')
  })
  return { markdown: `${lines.join('\n')}\n`, ordered }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await fs.readFile(options.input, 'utf8'))
  const scored = report.candidates.map(scoreCandidate)
  const clusters = clusterCandidates(scored)
  const selected = selectDiverse(clusters, options.count)
  const { markdown, ordered } = blindMarkdown(selected, report.createdAt)
  const selectedIds = new Set(selected.map(value => value.id))
  const answerKey = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceReport: options.input,
    sourceCreatedAt: report.createdAt,
    inputCandidates: scored.length,
    clusters: clusters.length,
    selected: selected.length,
    blindOrder: ordered.map((cluster, index) => ({ blindNumber: index + 1, clusterId: cluster.id })),
    selections: selected.map((cluster, rank) => ({
      rank: rank + 1,
      clusterId: cluster.id,
      adjustedScore: cluster.adjustedScore,
      representative: cluster.representative,
      alternatives: cluster.members.slice(1),
    })),
    rejected: clusters.filter(cluster => !selectedIds.has(cluster.id)).map(cluster => ({
      clusterId: cluster.id,
      representative: cluster.representative,
      alternatives: cluster.members.slice(1),
    })),
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'BLIND_REVIEW.md'), markdown, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'ANSWER_KEY.json'), `${JSON.stringify(answerKey, null, 2)}\n`, 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ inputCandidates: scored.length, clusters: clusters.length, selected: selected.length }, null, 2)}\n`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
