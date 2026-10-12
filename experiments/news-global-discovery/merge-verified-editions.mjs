import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { candidatesDescribeSameThread, headlinesExplicitlyConflict } from './select-five-lane-edition.mjs'

const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') } }
const sourceCount = card => new Set((card.acceptedSources || []).map(source => source.family || source.domain)).size
const normalizedHeadline = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

function sameEvent(left, right) {
  if (left.eventId === right.eventId) return true
  if (canonical(left.primaryUrl) && canonical(left.primaryUrl) === canonical(right.primaryUrl)) return true
  if (normalizedHeadline(left.headline) && normalizedHeadline(left.headline) === normalizedHeadline(right.headline)) return true
  if (headlinesExplicitlyConflict({ title: left.headline }, { title: right.headline })) return false
  return candidatesDescribeSameThread({ title: left.headline }, { title: right.headline })
}

export function mergeVerifiedEditions(editions) {
  const clusters = []
  for (const card of editions.flatMap(edition => edition.cards || [])) {
    const cluster = clusters.find(existing => existing.members.some(member => sameEvent(member, card)))
    if (!cluster) clusters.push({ representative: card, members: [card] })
    else {
      cluster.members.push(card)
      if (sourceCount(card) > sourceCount(cluster.representative) || Date.parse(card.publishedAt || 0) > Date.parse(cluster.representative.publishedAt || 0)) cluster.representative = card
    }
  }
  const cards = clusters.map(cluster => cluster.representative)
  const ranked = rankFrontPage(cards), audit = auditEdition(ranked)
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceEditionCount: editions.length, cards: ranked, audit }
}

async function main() {
  const inputs = [], outputDir = process.argv[process.argv.indexOf('--output-dir') + 1]
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === '--input') inputs.push(process.argv[index + 1])
  if (inputs.length < 2 || !outputDir) throw new Error('at least two --input values and --output-dir are required')
  const editions = await Promise.all(inputs.map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const output = mergeVerifiedEditions(editions)
  await fs.mkdir(outputDir, { recursive: true }); await fs.writeFile(path.join(outputDir, 'MERGED_VERIFIED_EDITION.json'), `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ cards: output.audit.total, laneCounts: output.audit.laneCounts, regionCounts: output.audit.regionCounts, laneGaps: output.audit.laneGaps, regionGaps: output.audit.regionGaps }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
