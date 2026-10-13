import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { independentSourceGroups } from './verify-unified-shortlist.mjs'

function quality(card) {
  const sources = (card.acceptedSources || []).map(source => ({ ...source, accepted: true }))
  return independentSourceGroups(sources).length * 100 + Number(card.selectionScore || 0) + Number(card.frontPageRanking?.score || 0)
}

function stableId(card) {
  const key = card.primaryUrl || card.headline
  return `replacement-${createHash('sha256').update(String(key)).digest('hex').slice(0, 16)}`
}

function sameCard(left, right) {
  return left.primaryUrl === right.primaryUrl || left.headline.toLowerCase() === right.headline.toLowerCase()
}

export function selectReplacementFinalists(audits, demand) {
  const candidates = []
  for (const card of audits.flatMap(audit => audit.cards || [])) if (!candidates.some(existing => sameCard(existing, card))) candidates.push(card)
  const selected = [], take = card => { if (!selected.includes(card)) selected.push(card) }
  const laneNeeds = { ...(demand.audit?.laneGaps || {}) }
  const regionNeeds = { ...(demand.audit?.regionGaps || {}) }
  const ranked = values => [...values].sort((a, b) => quality(b) - quality(a) || String(a.headline).localeCompare(String(b.headline)))

  for (const [region, count] of Object.entries(regionNeeds)) for (let index = 0; index < count; index += 1) {
    const card = ranked(candidates.filter(item => !selected.includes(item) && item.priorityRegions?.includes(region) && Number(laneNeeds[item.lane] || 0) > 0))[0]
    if (!card) throw new Error(`No distinct source-ready replacement satisfies the ${region} region gap`)
    take(card); laneNeeds[card.lane] -= 1
  }
  for (const [lane, count] of Object.entries(laneNeeds)) for (let index = 0; index < count; index += 1) {
    const card = ranked(candidates.filter(item => !selected.includes(item) && item.lane === lane))[0]
    if (!card) throw new Error(`No distinct source-ready replacement satisfies the remaining ${lane} gap`)
    take(card)
  }
  const cards = selected.map((card, index) => ({ ...card, eventId: stableId(card), replacementRank: index + 1 }))
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), demand: demand.audit,
    sourceAuditCount: audits.length, candidateCount: candidates.length, cards,
    audit: {
      total: cards.length,
      laneCounts: Object.fromEntries(Object.keys(demand.audit.laneGaps).map(lane => [lane, cards.filter(card => card.lane === lane).length])),
      regionCounts: Object.fromEntries(Object.keys(demand.audit.regionGaps).map(region => [region, cards.filter(card => card.priorityRegions?.includes(region)).length])),
    },
  }
}

function markdown(output) {
  const lines = ['# Exact replacement finalists', '', `${output.cards.length} source-ready, cross-batch-distinct cards selected for the six measured writer gaps.`, '']
  output.cards.forEach((card, index) => lines.push(`${index + 1}. **${card.headline}** — ${card.lane}${card.priorityRegions?.length ? ` · ${card.priorityRegions.join(', ')}` : ''} · ${independentSourceGroups(card.acceptedSources.map(source => ({ ...source, accepted: true }))).length} independent source family/families`))
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), values = flag => args.flatMap((value, index) => value === flag ? [args[index + 1]] : [])
  const auditFiles = values('--audit'), demandFile = values('--demand')[0], outputDir = values('--output-dir')[0]
  if (!auditFiles.length || !demandFile || !outputDir) throw new Error('at least one --audit, --demand and --output-dir are required')
  const [demand, ...audits] = await Promise.all([fs.readFile(demandFile, 'utf8').then(JSON.parse), ...auditFiles.map(file => fs.readFile(file, 'utf8').then(JSON.parse))])
  const output = selectReplacementFinalists(audits, demand)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'REPLACEMENT_FINALISTS.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'REPLACEMENT_FINALISTS.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ cards: output.cards.length, laneCounts: output.audit.laneCounts, regionCounts: output.audit.regionCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })

