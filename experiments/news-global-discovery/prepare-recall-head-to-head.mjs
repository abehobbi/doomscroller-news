import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compactEvidence, prepareEditorialFixture } from './editorial-selector.mjs'

function stableOrder(values) {
  return [...values].sort((a, b) => `${a.eventId}|${a.headline}`.localeCompare(`${b.eventId}|${b.headline}`))
}

export function prepareRecallHeadToHead(baseline, recallEdition) {
  const existing = (baseline.cards || []).map(card => ({
    eventId: card.eventId,
    lane: card.lane,
    priorityRegions: card.priorityRegions || [],
    headline: card.headline,
    evidence: compactEvidence((card.pages || []).map(page => page.text).join(' ')),
    publishedAt: card.publishedAt,
    baselineSelected: true,
    baselineRank: card.frontPageRank ?? card.shortlistOrder ?? null,
    source: { publisher: card.acceptedSources?.[0]?.domain || null, url: card.primaryUrl },
    cohort: 'baseline',
  }))
  const recall = prepareEditorialFixture(recallEdition, {
    includeReserves: false,
    includedLanes: new Set(['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']),
  }).candidates.map(candidate => ({ ...candidate, baselineSelected: false, baselineRank: null, cohort: 'recall' }))
  const prepared = stableOrder([...existing, ...recall]).map((candidate, index) => ({
    ...candidate,
    blindId: `E${String(index + 1).padStart(3, '0')}`,
  }))
  const candidates = prepared.filter(candidate => candidate.evidence.length >= 180)
  const excluded = prepared.filter(candidate => candidate.evidence.length < 180).map(candidate => ({
    eventId: candidate.eventId, headline: candidate.headline, cohort: candidate.cohort,
    reason: 'less than 180 characters of usable evidence remained after boilerplate removal',
  }))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    purpose: 'Blind head-to-head comparison of the verified baseline edition and source-ready targeted-recall candidates.',
    candidates,
    excluded,
    audit: {
      baselineInput: existing.length,
      recallInput: recall.length,
      compared: candidates.length,
      excluded: excluded.length,
    },
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const baselinePath = value('--baseline'), recallPath = value('--recall'), output = value('--output')
  if (!baselinePath || !recallPath || !output) throw new Error('--baseline, --recall and --output are required')
  const [baseline, recall] = await Promise.all([baselinePath, recallPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const fixture = prepareRecallHeadToHead(baseline, recall)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(fixture.audit, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
