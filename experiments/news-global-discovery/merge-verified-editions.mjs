import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { candidatesDescribeSameThread, headlinesExplicitlyConflict } from './select-five-lane-edition.mjs'

const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') } }
const sourceCount = card => new Set((card.acceptedSources || []).map(source => source.family || source.domain)).size

function sameEvent(left, right) {
  if (left.eventId === right.eventId) return true
  if (canonical(left.primaryUrl) && canonical(left.primaryUrl) === canonical(right.primaryUrl)) return true
  if (headlinesExplicitlyConflict({ title: left.headline }, { title: right.headline })) return false
  return candidatesDescribeSameThread({ title: left.headline }, { title: right.headline })
}

export function mergeVerifiedEditions(editions) {
  const cards = []
  for (const card of editions.flatMap(edition => edition.cards || [])) {
    const index = cards.findIndex(existing => sameEvent(existing, card))
    if (index < 0) cards.push(card)
    else if (sourceCount(card) > sourceCount(cards[index]) || Date.parse(card.publishedAt || 0) > Date.parse(cards[index].publishedAt || 0)) cards[index] = card
  }
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
