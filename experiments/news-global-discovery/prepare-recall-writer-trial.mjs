import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

export const PROMOTED_EVENT_IDS = new Set([
  'qualified-event-020', // Ghana pharmaceutical park
  'qualified-event-013', // Syria / Aramco letter of credit
  'qualified-event-027', // Roman fort
  'qualified-event-008', // World Bank jobs council
  'qualified-event-035', // breathwork study
])

const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') } }

export function prepareRecallWriterTrial(edition, verification, repair) {
  const assessments = [...(verification.ready || []), ...(repair.results || []).filter(item => item.readiness?.ready)]
  const sourceByUrl = new Map(assessments.flatMap(item => item.sources.filter(source => source.accepted).map(source => [canonical(source.url), { item, source }])))
  const selected = edition.events.filter(event => PROMOTED_EVENT_IDS.has(event.id)).map((event, index) => {
    const snapshot = event.representative.snapshot
    const matching = assessments.find(item => item.sources.some(source => source.accepted && canonical(source.url) === canonical(snapshot.finalUrl || snapshot.sourceUrl)))
    if (!matching) throw new Error(`No source assessment for ${event.id}`)
    const sources = matching.sources.filter(source => source.accepted).map(source => ({ publisher: source.domain, url: source.url }))
    return {
      eventId: event.id, rank: index + 1, lane: event.representative.selection.assignedLane,
      headline: snapshot.title, publishedAt: snapshot.publishedAt,
      priorityRegions: event.representative.selection.representative.priorityRegions || [],
      evidence: snapshot.evidenceText,
      primarySource: { publisher: snapshot.publisher, url: snapshot.finalUrl || snapshot.sourceUrl },
      sources, supportingSources: sources.slice(1),
      independentSourceCount: matching.readiness.independentSourceFamilies,
      editorialRecommendation: 'strong', editorialScore: null,
      image: matching.readiness.image,
      readyForWriting: true, blockers: [],
    }
  })
  if (selected.length !== PROMOTED_EVENT_IDS.size) throw new Error(`Expected ${PROMOTED_EVENT_IDS.size} promoted events; found ${selected.length}`)
  const usedUrls = new Set(selected.flatMap(item => item.sources.map(source => canonical(source.url))))
  const results = assessments.filter(item => item.sources.some(source => usedUrls.has(canonical(source.url)))).map(item => ({
    eventId: item.eventId,
    accepted: item.sources.filter(source => source.accepted).map(source => ({
      url: source.url, domain: source.domain, publishedAt: source.publishedAt,
      propositions: completeSentences(source.evidenceText || '', { maxChars: 5000, maxSentences: 18 }),
    })),
  }))
  return {
    shortlist: { schemaVersion: 1, createdAt: new Date().toISOString(), sourceReadiness: 'targeted-recall-head-to-head', selected },
    verification: { schemaVersion: 1, createdAt: new Date().toISOString(), results },
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const editionPath = value('--edition'), verificationPath = value('--verification'), repairPath = value('--repair'), outputDir = value('--output-dir')
  if (!editionPath || !verificationPath || !repairPath || !outputDir) throw new Error('--edition, --verification, --repair and --output-dir are required')
  const [edition, verification, repair] = await Promise.all([editionPath, verificationPath, repairPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const prepared = prepareRecallWriterTrial(edition, verification, repair)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'WRITER_SHORTLIST.json'), `${JSON.stringify(prepared.shortlist, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'WRITER_VERIFICATION.json'), `${JSON.stringify(prepared.verification, null, 2)}\n`),
  ])
  process.stdout.write(`${JSON.stringify({ selected: prepared.shortlist.selected.length, verificationResults: prepared.verification.results.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
