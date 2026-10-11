import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compactEvidence } from './editorial-selector.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { sourceAssessment } from './selection-safeguards.mjs'
import { readinessForAssessment } from './build-writer-ready-shortlist.mjs'

function source(member) {
  return { publisher: member.snapshot.publisher, url: member.snapshot.finalUrl || member.snapshot.sourceUrl }
}

export function assessFinalCandidate(candidate) {
  const event = candidate.event
  const representative = event.representative
  const evidenceQuality = assessExtractedEvidence(representative.snapshot.evidenceText || '')
  const writerEvidence = compactEvidence(representative.snapshot.evidenceText || '', { maxChars: 4200 })
  const primarySource = source(representative)
  const assessment = sourceAssessment({ headline: candidate.headline, source: primarySource, evaluation: { strongest_fact: writerEvidence } })
  const existingSupport = Math.max(0, Number(event.independentSourceCount || 0) - 1)
  const sourceReadiness = readinessForAssessment(assessment, existingSupport, 1)
  const imageUrl = representative.snapshot.imageUrl || null
  const blockers = []
  if (!evidenceQuality.adequate) blockers.push(...evidenceQuality.reasons.map(reason => `evidence: ${reason}`))
  if (writerEvidence.length < 180) blockers.push('evidence: fewer than 180 writer-safe characters')
  if (!sourceReadiness.ready) blockers.push(`sources: ${sourceReadiness.reason}`)
  if (!imageUrl) blockers.push('image: no publisher image URL')
  return {
    eventId: candidate.eventId,
    rank: candidate.rank,
    lane: candidate.lane,
    headline: candidate.headline,
    publishedAt: representative.snapshot.publishedAt,
    priorityRegions: representative.selection.representative?.priorityRegions || [],
    evidence: writerEvidence,
    evidenceQuality,
    primarySource,
    sources: event.members.map(source),
    sourceAssessment: assessment,
    independentSourceCount: Number(event.independentSourceCount || 0),
    sourceReadiness,
    image: { url: imageUrl, alt: representative.snapshot.imageAlt || null, publisher: representative.snapshot.publisher, sourceUrl: primarySource.url },
    readyForImageProbe: Boolean(imageUrl),
    readyForWriting: blockers.length === 0,
    blockers,
  }
}

export function auditFinalCandidates(edition) {
  const candidates = edition.selected.map(assessFinalCandidate)
  const ready = candidates.filter(value => value.readyForWriting)
  const repair = candidates.filter(value => !value.readyForWriting && value.blockers.some(reason => reason.startsWith('sources:')))
  const withheld = candidates.filter(value => !value.readyForWriting && !repair.includes(value))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceEdition: edition.createdAt,
    candidateCount: candidates.length,
    readyCount: ready.length,
    repairCount: repair.length,
    withheldCount: withheld.length,
    ready,
    repair,
    withheld,
    verificationQueue: repair.map(value => ({
      ...value,
      blindId: value.eventId,
      destination: value.lane,
      source: value.primarySource,
      editorialRecommendation: 'baseline-qualified',
      evaluation: { recommendation: 'baseline-qualified', strongest_fact: value.evidence },
      gapRecoveryRequested: true,
    })),
  }
}

function render(report) {
  const lines = [
    '# Final-candidate readiness audit', '',
    `Audited ${report.candidateCount} finalists: ${report.readyCount} provisionally writer-ready, ${report.repairCount} need source repair, and ${report.withheldCount} have non-source blockers.`, '',
    'Image URLs are checked for presence here; live image delivery is a separate probe before writing.', '',
  ]
  for (const [title, values] of [['Provisionally ready', report.ready], ['Needs repair', report.repair], ['Withheld', report.withheld]]) {
    lines.push(`## ${title}`, '')
    for (const item of values) lines.push(`- ${item.rank}. ${item.headline} — ${item.blockers.join('; ') || `${item.independentSourceCount} independent source family/families; evidence and image present`}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output-dir')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output-dir are required')
  const edition = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const report = auditFinalCandidates(edition)
  const outputDir = process.argv[outputIndex + 1]
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'READINESS_AUDIT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'READINESS_AUDIT.md'), render(report), 'utf8'),
    fs.writeFile(path.join(outputDir, 'SOURCE_VERIFICATION_QUEUE.json'), `${JSON.stringify({ schemaVersion: 1, createdAt: report.createdAt, withheld: report.verificationQueue }, null, 2)}\n`, 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ candidateCount: report.candidateCount, readyCount: report.readyCount, repairCount: report.repairCount, withheldCount: report.withheldCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
