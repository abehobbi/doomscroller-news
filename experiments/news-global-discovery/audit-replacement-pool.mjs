import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compareCandidateEvents } from './event-corroboration.mjs'

function canonical(value) {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|at_medium|at_campaign)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

function evidence(card) {
  return (card.pages || []).map(page => page.text || '').join('\n\n').slice(0, 6000)
}

function comparable({ id, headline, publishedAt, description, url }) {
  return {
    selection: { id, representative: { title: headline, publishedAt, url } },
    snapshot: { title: headline, publishedAt, evidenceText: description || '', finalUrl: url, sourceUrl: url, publisher: '' },
  }
}

function priorCards(report) {
  return (report.results || []).filter(item => item.status === 'accepted').map(item => ({
    eventId: item.eventId,
    headline: item.card?.headline || item.sourceTitle,
    sourceTitle: item.sourceTitle,
    publishedAt: null,
    urls: (item.sources || []).map(source => canonical(source.url)),
    description: evidence(item.card || {}),
  }))
}

function sourceUrls(card) {
  return [...new Set([card.primaryUrl, ...(card.acceptedSources || []).map(source => source.url)].map(canonical).filter(Boolean))]
}

function headlineOverlap(left, right) {
  const words = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 4))
  const a = words(left), b = words(right), shared = [...a].filter(word => b.has(word)).length
  return { shared, containment: shared / Math.max(1, Math.min(a.size, b.size)) }
}

export function auditReplacementPool(edition, priorReports) {
  const prior = (Array.isArray(priorReports) ? priorReports : [priorReports]).flatMap(priorCards)
  const accepted = [], overlaps = []
  for (const card of edition.cards || []) {
    const urls = sourceUrls(card)
    let match = null
    for (const old of prior) {
      const sharedUrl = urls.find(url => old.urls.includes(url))
      const comparisons = [card.headline, ...(card.acceptedSources || []).map(source => source.title)].flatMap(headline =>
        [old.headline, old.sourceTitle].filter(Boolean).map(priorHeadline => compareCandidateEvents(
          comparable({ id: card.eventId, headline, publishedAt: card.publishedAt, description: evidence(card), url: card.primaryUrl }),
          comparable({ id: old.eventId, headline: priorHeadline, publishedAt: old.publishedAt, description: old.description, url: old.urls[0] }),
        )))
      const comparison = comparisons.sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0]
      const titleMatch = [old.headline, old.sourceTitle].some(priorHeadline => {
        const value = headlineOverlap(card.headline, priorHeadline)
        return value.shared >= 4 && value.containment >= 0.5
      })
      if (sharedUrl || comparison?.relation === 'same-event' || titleMatch) {
        match = { eventId: card.eventId, headline: card.headline, priorEventId: old.eventId, priorHeadline: old.headline, reason: sharedUrl ? `shared canonical source URL (${sharedUrl})` : comparison?.relation === 'same-event' ? comparison.reason : 'strong cross-batch headline overlap', relation: comparison?.relation === 'same-event' ? comparison.relation : 'same-event' }
        break
      }
      if (comparison?.relation === 'update-chain') {
        match = { eventId: card.eventId, headline: card.headline, priorEventId: old.eventId, priorHeadline: old.headline, reason: comparison.reason, relation: 'update-chain' }
        break
      }
    }
    if (match) overlaps.push(match)
    else accepted.push(card)
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: edition.sources || null, priorAcceptedCount: prior.length, inspected: (edition.cards || []).length, newCandidateCount: accepted.length, overlapCount: overlaps.length, overlaps, cards: accepted }
}

function markdown(output) {
  const lines = ['# Replacement pool cross-batch audit', '', `${output.newCandidateCount} genuinely new candidates · ${output.overlapCount} overlaps withheld · ${output.priorAcceptedCount} prior accepted cards checked.`, '', '## New candidates', '']
  output.cards.forEach((card, index) => lines.push(`${index + 1}. **${card.headline}** — ${card.lane}${card.priorityRegions?.length ? ` · ${card.priorityRegions.join(', ')}` : ''}`))
  lines.push('', '## Withheld overlaps', '')
  output.overlaps.forEach(item => lines.push(`- **${item.headline}** ↔ ${item.priorHeadline} — ${item.relation}: ${item.reason}`))
  return `${lines.join('\n')}\n`
}

async function main() {
  const editionIndex = process.argv.indexOf('--edition'), outputIndex = process.argv.indexOf('--output-dir')
  const priorFiles = []
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === '--prior') priorFiles.push(process.argv[index + 1])
  if (editionIndex < 0 || !priorFiles.length || outputIndex < 0) throw new Error('--edition, at least one --prior, and --output-dir are required')
  const [edition, ...priors] = await Promise.all([fs.readFile(process.argv[editionIndex + 1], 'utf8').then(JSON.parse), ...priorFiles.map(file => fs.readFile(file, 'utf8').then(JSON.parse))])
  const output = auditReplacementPool(edition, priors)
  const outputDir = process.argv[outputIndex + 1]
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'REPLACEMENT_AUDIT.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'REPLACEMENT_AUDIT.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ inspected: output.inspected, newCandidates: output.newCandidateCount, overlaps: output.overlapCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })

