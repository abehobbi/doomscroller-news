import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { independentSourceGroups } from './verify-unified-shortlist.mjs'

const canonical = value => {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|at_medium|at_campaign)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

export function prepareVerifiedWriterBatch(edition) {
  const selected = [], results = []
  for (const [index, card] of (edition.cards || []).entries()) {
    const sources = (card.acceptedSources || []).filter(source => source.url && source.evidenceText)
    if (!sources.length) throw new Error(`Card ${card.eventId || index + 1} has no source-bound evidence`)
    const primary = sources.find(source => canonical(source.url) === canonical(card.primaryUrl)) || sources[0]
    const sourceLinks = sources.map(source => ({ publisher: source.domain, url: source.url }))
    selected.push({
      eventId: card.eventId, baselineRank: card.frontPageRank || index + 1,
      lane: card.lane, headline: card.headline, publishedAt: card.publishedAt,
      priorityRegions: card.priorityRegions || [], evidence: primary.evidenceText,
      primarySource: { publisher: primary.domain, url: primary.url },
      sources: sourceLinks, supportingSources: sourceLinks.filter(source => canonical(source.url) !== canonical(primary.url)),
      independentSourceCount: independentSourceGroups(sources.map(source => ({ ...source, accepted: true }))).length,
      editorialRecommendation: 'source-ready', editorialScore: card.selectionScore || null,
      image: card.image, imageException: card.imageException || null, readyForWriting: true, blockers: [],
    })
    results.push({
      eventId: card.eventId,
      accepted: sources.map(source => ({
        url: source.url, domain: source.domain, publishedAt: source.publishedAt,
        propositions: completeSentences(source.evidenceText, { maxChars: 5000, maxSentences: 18 }),
      })),
    })
  }
  return {
    shortlist: { schemaVersion: 1, createdAt: new Date().toISOString(), sourceReadiness: 'merged-verified-edition', selected },
    verification: { schemaVersion: 1, createdAt: new Date().toISOString(), results },
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const input = value('--input'), outputDir = value('--output-dir')
  if (!input || !outputDir) throw new Error('--input and --output-dir are required')
  const prepared = prepareVerifiedWriterBatch(JSON.parse(await fs.readFile(input, 'utf8')))
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'WRITER_SHORTLIST.json'), `${JSON.stringify(prepared.shortlist, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'WRITER_VERIFICATION.json'), `${JSON.stringify(prepared.verification, null, 2)}\n`),
  ])
  process.stdout.write(`${JSON.stringify({ cards: prepared.shortlist.selected.length, verificationResults: prepared.verification.results.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
