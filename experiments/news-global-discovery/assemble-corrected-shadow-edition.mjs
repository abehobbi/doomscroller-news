import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FINAL_EVENT_IDS = [
  'qualified-event-001', 'qualified-event-074', 'qualified-event-051', 'qualified-event-053', 'qualified-event-055',
  'qualified-event-087', 'qualified-event-078', 'qualified-event-068', 'qualified-event-066', 'qualified-event-024',
  'qualified-event-025', 'qualified-event-019', 'qualified-event-010', 'qualified-event-014', 'qualified-event-037',
  'qualified-event-042', 'qualified-event-113', 'qualified-event-039', 'qualified-event-100', 'qualified-event-008',
]

const REPLACED = [
  { eventId: 'qualified-event-029', reason: 'BBC .com and .co.uk were the same publisher family; no fresh independent current support was recovered.' },
  { eventId: 'qualified-event-105', reason: 'The apparent support was stale 2025 reporting rather than fresh independent confirmation.' },
  { eventId: 'qualified-event-016', reason: 'The derivative science page was not replaced by the original paper or a fresh authoritative release.' },
  { eventId: 'qualified-event-107', reason: 'No authoritative excavation announcement or second strong source was recovered.' },
]

function parseArgs(argv) {
  const options = { reports: [], enrichment: null, outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--report') options.reports.push(argv[++index])
    else if (argv[index] === '--enrichment') options.enrichment = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if (!options.reports.length || !options.enrichment || !options.outputDir) throw new Error('At least one --report, --enrichment and --output-dir are required')
  return options
}

export function assembleCorrectedEdition(reports, enrichment) {
  const resultById = new Map()
  for (const report of reports) for (const result of report.results || []) resultById.set(result.eventId, result)
  const missing = FINAL_EVENT_IDS.filter(eventId => !resultById.has(eventId))
  if (missing.length) throw new Error(`Missing final events: ${missing.join(', ')}`)
  const enrichedByUrl = new Map()
  for (const item of enrichment.items || []) {
    if (item.sourceUrl) enrichedByUrl.set(item.sourceUrl, item)
    if (item.finalUrl) enrichedByUrl.set(item.finalUrl, item)
  }
  const cards = FINAL_EVENT_IDS.map((eventId, index) => {
    const result = resultById.get(eventId)
    if (result.status !== 'accepted') throw new Error(`${eventId} is not accepted in its latest report`)
    const image = result.sources.map(source => enrichedByUrl.get(source.url)).find(item => item?.imageUrl)
    if (!image?.imageUrl) throw new Error(`${eventId} has no publisher image`)
    return {
      order: index + 1,
      eventId,
      lane: result.lane,
      headline: result.card.headline,
      pages: result.card.pages,
      uncertainties: result.card.uncertainties || [],
      sources: result.sources,
      image: { url: image.imageUrl, alt: image.imageAlt || null, publisher: image.publisher, sourceUrl: image.sourceUrl },
      audits: result.audits,
      provider: result.provider,
    }
  })
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    shadowOnly: true,
    cardCount: cards.length,
    allCardsAccepted: cards.every(card => card.provider.complete),
    everyCardHasPublisherImage: cards.every(card => Boolean(card.image.url)),
    laneCounts: Object.fromEntries([...new Set(cards.map(card => card.lane))].map(lane => [lane, cards.filter(card => card.lane === lane).length])),
    replacedEvents: REPLACED,
    cards,
  }
}

function markdown(edition) {
  const labels = { 'world-major': 'Major world', 'priority-major': 'Major priority region', 'world-interesting': 'Interesting world', 'priority-interesting': 'Interesting priority region', discovery: 'Discovery' }
  const lines = [
    '# Corrected 20-card News shadow edition', '',
    'This is a review artifact only. It has not been published to Doomscroller or Beta.', '',
    `Cards: ${edition.cardCount}; all have complete accepted output: ${edition.allCardsAccepted}; all have a publisher image: ${edition.everyCardHasPublisherImage}.`, '',
  ]
  for (const card of edition.cards) {
    lines.push(`## ${card.order}. ${card.headline}`, '', `Lane: ${labels[card.lane] || card.lane}`, '', `Image: [${card.image.publisher}](${card.image.url})`, '')
    for (const page of card.pages) lines.push(page.text, '')
    if (card.uncertainties.length) lines.push(`Uncertainties: ${card.uncertainties.join(' · ')}`, '')
    lines.push(`Sources: ${card.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
  }
  lines.push('## Replaced after source audit', '')
  for (const item of edition.replacedEvents) lines.push(`- ${item.eventId}: ${item.reason}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const reports = await Promise.all(options.reports.map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const enrichment = JSON.parse(await fs.readFile(options.enrichment, 'utf8'))
  const edition = assembleCorrectedEdition(reports, enrichment)
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'CORRECTED_EDITION.json'), `${JSON.stringify(edition, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'CORRECTED_EDITION.md'), markdown(edition), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ cardCount: edition.cardCount, laneCounts: edition.laneCounts, everyCardHasPublisherImage: edition.everyCardHasPublisherImage }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
