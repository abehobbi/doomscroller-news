import fs from 'node:fs/promises'
import path from 'node:path'
import { classifyGeography, compareEvents } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

const LABELS = {
  'world-interesting': 'Interesting world',
  'priority-interesting': 'Interesting priority region',
  'world-major': 'Major world',
  'priority-major': 'Major priority region',
  discovery: 'Discovery',
}
const LOCAL_REGION_DOMAINS = {
  Bangladesh: ['thedailystar.net', 'tbsnews.net', 'dhakatribune.com', 'prothomalo.com', 'bdnews24.com', 'agronewstoday.com'],
  Ghana: ['myjoyonline.com', 'citinewsroom.com', 'graphic.com.gh', 'ghanaweb.com', 'gna.org.gh', 'chale.news'],
  Syria: ['syria-direct.org', 'npasyria.com', 'enabbaladi.net', 'sana.sy'],
  Canada: ['cbc.ca', 'globalnews.ca', 'ctvnews.ca'],
  GTA: ['toronto.ca', 'toronto.com', 'thestar.com', 'cp24.com', 'gtaconstructionreport.com'],
}

function parseArgs(argv) {
  const options = { edition: null, enrichment: null, outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--edition') options.edition = argv[++index]
    else if (argv[index] === '--enrichment') options.enrichment = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if (!options.edition || !options.enrichment || !options.outputDir) throw new Error('--edition, --enrichment, and --output-dir are required')
  return options
}

function qualify(selection, snapshot) {
  const reasons = []
  if (!snapshot || snapshot.status !== 'ok') reasons.push('article page inaccessible')
  if (!snapshot || snapshot.evidenceChars < 180) reasons.push('insufficient source evidence')
  if (!snapshot?.imageUrl) reasons.push('no publisher image found')
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
  return { selection, snapshot, detectedRegions, eligible: reasons.length === 0, rejectionReasons: reasons }
}

function asArticle(item) {
  return {
    id: item.selection.id,
    title: item.snapshot.title || item.selection.representative.title,
    description: item.snapshot.evidenceText.slice(0, 1800),
    url: item.snapshot.finalUrl || item.snapshot.sourceUrl,
    publishedAt: item.snapshot.publishedAt || item.selection.representative.publishedAt,
  }
}

function related(left, right) {
  try { return compareEvents(asArticle(left), asArticle(right)) } catch { return { relation: 'distinct-or-uncertain', score: 0, reason: 'comparison failed safely' } }
}

function clusterEligible(items) {
  const clusters = []
  for (const item of items) {
    let best = null
    for (const cluster of clusters) {
      for (const member of cluster.members) {
        const comparison = related(item, member)
        if (comparison.relation !== 'distinct-or-uncertain' && (!best || comparison.score > best.comparison.score)) best = { cluster, comparison }
      }
    }
    if (best) {
      best.cluster.members.push(item)
      best.cluster.relations.push({ left: item.selection.id, right: best.cluster.members[0].selection.id, ...best.comparison })
    } else clusters.push({ id: `qualified-event-${String(clusters.length + 1).padStart(3, '0')}`, members: [item], relations: [] })
  }
  return clusters.map(cluster => {
    const representative = [...cluster.members].sort((a, b) => {
      const time = Date.parse(b.snapshot.publishedAt || '') - Date.parse(a.snapshot.publishedAt || '')
      if (Number.isFinite(time) && time !== 0) return time
      return b.snapshot.evidenceChars - a.snapshot.evidenceChars
    })[0]
    const lanes = [...new Set(cluster.members.map(member => member.selection.assignedLane))]
    return { ...cluster, representative, lanes }
  })
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
  const clusters = clusterEligible(audited.filter(item => item.eligible))
  const laneCounts = {}
  for (const cluster of clusters) {
    const lane = cluster.representative.selection.assignedLane
    laneCounts[lane] = (laneCounts[lane] || 0) + 1
  }
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    sourceEdition: options.edition, sourceEnrichment: options.enrichment,
    requestedCandidates: edition.selections.length,
    rejectedCandidates: rejected.length,
    qualifiedEvents: clusters.length,
    laneCounts, events: clusters, rejected,
    priorityRegionCounts: Object.fromEntries([...new Set(clusters.flatMap(cluster => cluster.representative.selection.representative.priorityRegions || []))].map(region => [region, clusters.filter(cluster => (cluster.representative.selection.representative.priorityRegions || []).includes(region)).length])),
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'QUALIFIED_EDITION.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'QUALIFIED_EDITION.md'), render(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ requestedCandidates: report.requestedCandidates, rejectedCandidates: report.rejectedCandidates, qualifiedEvents: report.qualifiedEvents, laneCounts }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
