import fs from 'node:fs/promises'
import path from 'node:path'
import { classifyGeography } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { clusterCorroboratedEvents } from './event-corroboration.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'

const LABELS = {
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
const REGION_MINIMUMS = { Syria: 2, 'Middle East': 2, Bangladesh: 2, Ghana: 2, Canada: 2, GTA: 1 }
const LOCAL_REGION_DOMAINS = {
  Bangladesh: ['thedailystar.net', 'tbsnews.net', 'dhakatribune.com', 'prothomalo.com', 'bdnews24.com', 'agronewstoday.com'],
  Ghana: ['myjoyonline.com', 'citinewsroom.com', 'graphic.com.gh', 'ghanaweb.com', 'gna.org.gh', 'chale.news'],
  Syria: ['syria-direct.org', 'npasyria.com', 'enabbaladi.net', 'sana.sy'],
  Canada: ['cbc.ca', 'globalnews.ca', 'ctvnews.ca'],
  GTA: ['toronto.ca', 'toronto.com', 'thestar.com', 'cp24.com', 'gtaconstructionreport.com'],
}
const PROMOTIONAL = /\b(?:announces? landmark|launches? (?:new )?(?:initiative|construction)|open for business|wooing partnerships?|makes? giant strides?|fresh face|join us|award|selected for .* fellowship|invites?|guidelines on developing|plans? to)\b/i
const WEAK_MAJOR = /\b(?:analysis|anniversary|why |how |ready to|set to|could|may|report says|calls? for|urges?)\b/i
const CONCRETE_MAJOR = /\b(?:approves?|rejects?|passes?|clears?|signs?|bans?|halts?|removes?|begins?|takes? control|strikes?|attacks?|kills?|dies?|arrests?|convicts?|fines?|rises?|falls?|outbreak|earthquake|hurricane|flood|sanctions?|agreement|deal|court|election|troops?|ceasefire|law|rules?)\b/i
const STRONG_PUBLISHER = /^(?:reuters\.com|apnews\.com|bbc\.(?:com|co\.uk)|cbc\.ca|aljazeera\.com|theguardian\.com|nature\.com|npr\.org|globalnews\.ca|hrw\.org|abc\.net\.au|asia\.nikkei\.com)$/
const WEAK_PUBLISHER = /^(?:torontosun\.com|timesofindia\.indiatimes\.com|economictimes\.indiatimes\.com|scienmag\.com)$/
const DISCOVERY_JARGON = /\b(?:single-nucleus|transcriptomic|genomic pipeline|known and unknown genomes|cortical dynamics|fractal dimension|productive forces)\b/i

function parseArgs(argv) {
  const options = { edition: null, enrichment: null, outputDir: null, count: 65 }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--edition') options.edition = argv[++index]
    else if (argv[index] === '--enrichment') options.enrichment = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--count') options.count = Number(argv[++index])
  }
  if (!options.edition || !options.enrichment || !options.outputDir) throw new Error('--edition, --enrichment, and --output-dir are required')
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 65) throw new Error('--count must be from 1 to 65')
  return options
}

function qualify(selection, snapshot) {
  const reasons = []
  if (!snapshot || snapshot.status !== 'ok') reasons.push('article page inaccessible')
  if (!snapshot || snapshot.evidenceChars < 180) reasons.push('insufficient source evidence')
  const evidenceQuality = snapshot?.evidenceQuality || assessExtractedEvidence(snapshot?.evidenceText)
  if (snapshot && !evidenceQuality.adequate) reasons.push(...evidenceQuality.reasons)
  if (!snapshot?.imageUrl) reasons.push('no publisher image found')
  if (!snapshot?.title || snapshot.title.length < 24 || /\b(?:and|or|the|a|to|of|for|with|they|he|she|it|its|their)\s*$/i.test(snapshot.title)) reasons.push('headline is incomplete or not self-contained')
  const expectedRegions = selection.representative.priorityRegions || []
  let detectedRegions = []
  if (snapshot && expectedRegions.length) {
    const geography = classifyGeography({ title: snapshot.title, description: snapshot.evidenceText.slice(0, 1800) })
    detectedRegions = [...geography.priorityRegions]
    const centralText = `${snapshot.title || ''} ${snapshot.evidenceText.slice(0, 900)}`
    if (/\bmiddle east(?:ern)?\b/i.test(centralText)) detectedRegions.push('Middle East')
    if (/\b(?:iqaluit|nunavut|northwest territories|yukon)\b/i.test(centralText)) detectedRegions.push('Canada')
    detectedRegions = [...new Set(detectedRegions)]
    const directMatch = expectedRegions.some(region => detectedRegions.includes(region))
    const publisher = String(snapshot.publisher || '').replace(/^www\./, '')
    const localMatch = expectedRegions.some(region => (LOCAL_REGION_DOMAINS[region] || []).some(domain => publisher === domain || publisher.endsWith(`.${domain}`)))
      && geography.eventLocations.length === 0
    if (!directMatch && !localMatch) reasons.push(`priority-region centrality not established (expected ${expectedRegions.join('/') || 'none'})`)
  }
  return { selection, snapshot, detectedRegions, evidenceQuality, eligible: reasons.length === 0, rejectionReasons: reasons }
}

function editorialAdjustment(cluster) {
  const item = cluster.representative
  const title = item.snapshot.title || item.selection.representative.title
  const lane = item.selection.assignedLane
  let score = 0
  if (STRONG_PUBLISHER.test(String(item.snapshot.publisher || '').replace(/^www\./, ''))) score += 8
  if (WEAK_PUBLISHER.test(String(item.snapshot.publisher || '').replace(/^www\./, ''))) score -= 22
  if (PROMOTIONAL.test(title)) score -= 32
  if (lane.includes('major')) {
    if (CONCRETE_MAJOR.test(title)) score += 10
    else score -= 15
    if (WEAK_MAJOR.test(title)) score -= 12
  }
  if (lane.includes('interesting') && /\b(?:village|community|family|residents?|workers?|farmers?|fishers?|tradition|livelihood|school|wildlife|forest|river|island|craft|human rights|detention|water)\b/i.test(`${title} ${item.snapshot.evidenceText.slice(0, 500)}`)) score += 8
  if (lane === 'discovery' && DISCOVERY_JARGON.test(title)) score -= 28
  return score
}

function selectQualified(clusters, maximum) {
  const selected = [], remaining = [...clusters]
  const laneCounts = Object.fromEntries(Object.keys(LANE_LIMITS).map(lane => [lane, 0]))
  const regionCounts = new Map(), domainCounts = new Map()
  while (remaining.length && selected.length < maximum) {
    const ranked = remaining.map(cluster => {
      const item = cluster.representative
      const lane = item.selection.assignedLane
      if (!LANE_LIMITS[lane] || laneCounts[lane] >= LANE_LIMITS[lane].maximum) return { cluster, score: -Infinity }
      const regions = item.selection.representative.priorityRegions || []
      const laneGap = laneCounts[lane] < LANE_LIMITS[lane].minimum ? 24 : laneCounts[lane] < LANE_LIMITS[lane].preferred ? 9 : 0
      const regionGap = Math.max(0, ...regions.map(region => Math.max(0, (REGION_MINIMUMS[region] || 0) - (regionCounts.get(region) || 0))))
      const publisherPenalty = Math.max(0, (domainCounts.get(item.snapshot.publisher) || 0) - 1) * 10
      const base = Number(item.selection.poolScore ?? item.selection.adjustedScore ?? 50)
      const corroborationBonus = Math.min(12, Math.max(0, cluster.independentSourceCount - 1) * 6)
      const riskPenalty = cluster.corroborationStatus === 'single-source-unattributed' ? 30 : 0
      return { cluster, score: base + laneGap + regionGap * 14 + Math.min(6, item.snapshot.evidenceChars / 3000) + corroborationBonus + editorialAdjustment(cluster) - riskPenalty - publisherPenalty }
    }).sort((a, b) => b.score - a.score)
    if (!ranked.length || !Number.isFinite(ranked[0].score)) break
    const choice = ranked[0].cluster
    selected.push({ ...choice, selectionScore: Number(ranked[0].score.toFixed(2)) })
    remaining.splice(remaining.indexOf(choice), 1)
    const item = choice.representative
    laneCounts[item.selection.assignedLane] += 1
    domainCounts.set(item.snapshot.publisher, (domainCounts.get(item.snapshot.publisher) || 0) + 1)
    for (const region of item.selection.representative.priorityRegions || []) regionCounts.set(region, (regionCounts.get(region) || 0) + 1)
  }
  return { selected, remaining, laneCounts, regionCounts: Object.fromEntries(regionCounts) }
}

function render(report) {
  const lines = [
    '# Evidence-qualified five-lane edition', '',
    `Audited: ${report.createdAt}`, '',
    `${report.qualifiedEvents} event candidates remain from ${report.requestedCandidates} shortlisted URLs. Candidates without usable source text or an event-specific publisher image are excluded; related same-event/update pages are represented once.`, '',
    '## Mix', '',
  ]
  for (const [lane, count] of Object.entries(report.laneCounts)) lines.push(`- ${LABELS[lane]}: ${count}`)
  lines.push('', '## Candidates', '')
  report.events.forEach((event, index) => {
    const item = event.representative
    lines.push(
      `### ${index + 1}. ${item.snapshot.title || item.selection.representative.title}`,
      '',
      `- Lane: ${event.lanes.map(lane => LABELS[lane]).join(', ')}`,
      `- Publisher: ${item.snapshot.publisher}`,
      `- Published: ${item.snapshot.publishedAt || 'unverified'}`,
      `- Evidence: ${item.snapshot.evidenceChars.toLocaleString()} extracted characters`,
      `- Image: ${item.snapshot.imageUrl}`,
      `- Sources/pages in event cluster: ${event.members.length}`,
      `- Independent source families: ${event.independentSourceCount}`,
      `- Corroboration: ${event.corroborationStatus}`,
      `- Link: ${item.snapshot.finalUrl || item.snapshot.sourceUrl}`,
      '',
    )
  })
  if (report.rejected.length) {
    lines.push('## Rejected before writing', '')
    report.rejected.forEach(item => lines.push(`- ${item.selection.representative.title}: ${item.rejectionReasons.join('; ')}`))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const edition = JSON.parse(await fs.readFile(options.edition, 'utf8'))
  const enrichment = JSON.parse(await fs.readFile(options.enrichment, 'utf8'))
  const snapshots = new Map(enrichment.items.map(item => [item.eventClusterId, item]))
  const audited = edition.selections.map(selection => qualify(selection, snapshots.get(selection.id)))
  const rejected = audited.filter(item => !item.eligible)
  const clusters = clusterCorroboratedEvents(audited.filter(item => item.eligible))
  const corroborationRejected = clusters.filter(cluster => cluster.corroborationStatus === 'single-source-unattributed')
  const finalSelection = selectQualified(clusters.filter(cluster => cluster.corroborationStatus !== 'single-source-unattributed'), options.count)
  const laneCounts = finalSelection.laneCounts
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    sourceEdition: options.edition, sourceEnrichment: options.enrichment,
    requestedCandidates: edition.selections.length,
    rejectedCandidates: rejected.length,
    qualifiedPoolEvents: clusters.length,
    corroborationRejectedEvents: corroborationRejected.length,
    qualifiedEvents: finalSelection.selected.length,
    laneCounts, events: finalSelection.selected, rejected,
    qualifiedButNotSelected: finalSelection.remaining,
    corroborationRejected,
    priorityRegionCounts: finalSelection.regionCounts,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'QUALIFIED_EDITION.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'QUALIFIED_EDITION.md'), render(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ requestedCandidates: report.requestedCandidates, rejectedCandidates: report.rejectedCandidates, qualifiedEvents: report.qualifiedEvents, laneCounts }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
