import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scoreFrontPageCard } from './final-edition-ranker.mjs'

const MAJOR = new Set(['world-major', 'priority-major'])
const ACTIONS = ['sanction', 'earthquake', 'flood', 'strike', 'attack', 'ceasefire', 'election', 'protest', 'outbreak', 'investigation', 'agreement', 'deal', 'ban']

function text(event) {
  return `${event.representative.snapshot.title} ${event.representative.snapshot.evidenceText}`
}

function acronymActionKey(event) {
  const headline = event.representative.snapshot.title
  const acronyms = [...headline.matchAll(/\b[A-Z]{3,}\b/g)].map(match => match[0]).filter(value => !['THE', 'AND'].includes(value))
  const lowered = headline.toLowerCase()
  const actions = ACTIONS.filter(action => lowered.includes(action))
  return acronyms.length && actions.length ? `${acronyms.sort().join('+')}:${actions.sort().join('+')}` : null
}

function deduplicate(candidates) {
  const seen = new Map(), output = []
  for (const candidate of [...candidates].sort((a, b) => b.feedScore - a.feedScore)) {
    const key = acronymActionKey(candidate.event)
    if (key && seen.has(key)) {
      seen.get(key).duplicates.push({ eventId: candidate.event.id, headline: candidate.headline, reason: `same named institution and action (${key})` })
      continue
    }
    const retained = { ...candidate, duplicates: [] }
    if (key) seen.set(key, retained)
    output.push(retained)
  }
  return output
}

export function assembleFinalCandidates(pool, editorialScores, { possibleFloor = 75, maximum = 65 } = {}) {
  const scoresByEvent = new Map((editorialScores.results || []).map(value => [value.eventId, value]))
  const candidates = []
  const withheld = []
  for (const event of pool.events || []) {
    const lane = event.representative.selection.assignedLane
    const headline = event.representative.snapshot.title
    const editorial = scoresByEvent.get(event.id) || null
    if (!MAJOR.has(lane)) {
      const recommendation = editorial?.evaluation?.recommendation
      const passes = recommendation === 'strong' || (recommendation === 'possible' && editorial.editorialScore >= possibleFloor)
      if (!passes) {
        withheld.push({ eventId: event.id, lane, headline, editorialScore: editorial?.editorialScore ?? null, recommendation: recommendation ?? 'missing', reason: editorial?.evaluation?.reason || 'No complete blind editorial judgment.' })
        continue
      }
    }
    const frontPage = scoreFrontPageCard({ headline, lane, pages: [{ text: event.representative.snapshot.evidenceText }] })
    const feedScore = Number((frontPage.score + Number(event.selectionScore || 0) * 0.05 + Number(editorial?.editorialScore || 0) * 0.35).toFixed(2))
    candidates.push({ event, eventId: event.id, lane, headline, editorial, frontPage, feedScore })
  }
  const selected = deduplicate(candidates).slice(0, maximum).map((value, index) => ({ ...value, rank: index + 1 }))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourcePool: pool.createdAt,
    sourceEditorialScores: editorialScores.createdAt,
    policy: { maximum, possibleFloor, majorNewsRequiresPriorEvidenceQualification: true, interestingAndDiscoveryRequire: `strong or possible with score >= ${possibleFloor}` },
    selectedCount: selected.length,
    laneCounts: Object.fromEntries([...new Set(selected.map(value => value.lane))].map(lane => [lane, selected.filter(value => value.lane === lane).length])),
    duplicateCount: selected.reduce((sum, value) => sum + value.duplicates.length, 0),
    selected,
    withheld,
  }
}

function render(report) {
  const lines = [
    '# Final News candidate edition', '',
    'This is a shadow selection artifact. It has not been written into cards or published.', '',
    `Selected ${report.selectedCount} stories. Withheld ${report.withheld.length} lower-confidence Interesting/Discovery candidates. Consolidated ${report.duplicateCount} additional duplicate candidate(s).`, '',
    '## Ranked candidates', '',
  ]
  for (const item of report.selected) {
    lines.push(`### ${item.rank}. ${item.headline}`, '', `- Lane: ${item.lane}`, `- Feed score: ${item.feedScore}`, `- Evidence source families: ${item.event.independentSourceCount}`, `- Ranking basis: ${item.frontPage.reasons.join('; ') || 'qualified lane and editorial evidence'}`)
    if (item.editorial) lines.push(`- Blind editorial judgment: ${item.editorial.editorialScore}/100 · ${item.editorial.evaluation.recommendation}`)
    for (const duplicate of item.duplicates) lines.push(`- Consolidated duplicate: ${duplicate.headline}`)
    lines.push('')
  }
  lines.push('## Withheld after blind editorial review', '')
  for (const item of report.withheld.sort((a, b) => (b.editorialScore || 0) - (a.editorialScore || 0))) lines.push(`- ${item.headline} — ${item.recommendation}, ${item.editorialScore ?? 'unscored'}/100. ${item.reason}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const poolIndex = process.argv.indexOf('--pool'), scoresIndex = process.argv.indexOf('--scores'), outputIndex = process.argv.indexOf('--output-dir')
  if (poolIndex < 0 || scoresIndex < 0 || outputIndex < 0) throw new Error('--pool, --scores and --output-dir are required')
  const [pool, scores] = await Promise.all([
    fs.readFile(process.argv[poolIndex + 1], 'utf8').then(JSON.parse),
    fs.readFile(process.argv[scoresIndex + 1], 'utf8').then(JSON.parse),
  ])
  if (!scores.complete) throw new Error('Editorial scoring is incomplete')
  const report = assembleFinalCandidates(pool, scores)
  const outputDir = process.argv[outputIndex + 1]
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'FINAL_CANDIDATE_EDITION.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'FINAL_CANDIDATE_EDITION.md'), render(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ selectedCount: report.selectedCount, laneCounts: report.laneCounts, duplicateCount: report.duplicateCount, withheld: report.withheld.length, top: report.selected.slice(0, 10).map(value => value.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
