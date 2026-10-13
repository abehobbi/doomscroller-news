import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { auditEditorialOverlap } from './qualify-shadow-edition.mjs'

export function assembleUnattendedShadowEdition(writerReport, shortlist) {
  const inputs = new Map((shortlist.selected || []).map(item => [item.eventId, item]))
  const accepted = (writerReport.results || []).filter(result => result.status === 'accepted')
  const rejected = (writerReport.results || []).filter(result => result.status !== 'accepted').map(result => ({
    eventId: result.eventId,
    sourceTitle: result.sourceTitle,
    failedChecks: Object.entries(result.audits || {}).filter(([, value]) => value?.valid === false).map(([name]) => name),
    complete: Boolean(result.provider?.complete),
  }))
  const rankedCards = rankFrontPage(accepted.map(result => {
    const input = inputs.get(result.eventId)
    if (!input?.image?.url && !input?.imageException?.granted) throw new Error(`Accepted card ${result.eventId} has neither a verified publisher image nor an approved image exception`)
    return {
      eventId: result.eventId,
      lane: result.lane,
      headline: result.card.headline,
      publishedAt: input.publishedAt,
      priorityRegions: input.priorityRegions || [],
      pages: result.card.pages,
      uncertainties: result.card.uncertainties || [],
      image: input.image,
      imageException: input.imageException || null,
      primaryUrl: input.primarySource?.url,
      sources: result.sources,
      acceptedSources: result.sources.map(source => ({ domain: source.publisher, family: source.publisher, url: source.url })),
      audits: result.audits,
      provider: result.provider,
    }
  }))
  const overlaps = auditEditorialOverlap(rankedCards)
  const quarantinedIds = new Set(overlaps.filter(item => item.requiresReview).map(item => item.rightEventId))
  const overlapRejections = rankedCards.filter(card => quarantinedIds.has(card.eventId)).map(card => ({
    eventId: card.eventId,
    sourceTitle: card.headline,
    failedChecks: ['post-generation overlap'],
    complete: true,
  }))
  rejected.push(...overlapRejections)
  const cards = rankFrontPage(rankedCards.filter(card => !quarantinedIds.has(card.eventId)))
  const audit = auditEdition(cards)
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    shadowOnly: true,
    requested: writerReport.expected,
    generated: writerReport.resultCount,
    accepted: cards.length,
    rejected,
    totalNeurons: writerReport.totalNeurons,
    audit,
    overlaps,
    quarantinedOverlaps: overlapRejections.length,
    requiresEditorialReview: rejected.length > 0 || overlaps.length > 0,
    cards,
  }
}

function markdown(edition) {
  const lines = [
    '# Unattended News shadow edition', '',
    'Review artifact only. Nothing here has been published to Doomscroller or Beta.', '',
    `Requested: ${edition.requested} · accepted: ${edition.accepted} · rejected: ${edition.rejected.length} · overlap flags: ${edition.overlaps.length} · neurons: ${edition.totalNeurons}.`, '',
    `Requires editorial review: ${edition.requiresEditorialReview}.`, '',
  ]
  if (edition.rejected.length) {
    lines.push('## Rejected by deterministic checks', '')
    for (const item of edition.rejected) lines.push(`- **${item.sourceTitle}** — ${item.complete ? item.failedChecks.join(', ') || 'unknown check' : 'incomplete output'}`)
    lines.push('')
  }
  if (edition.overlaps.length) {
    lines.push('## Possible duplicate or contaminated pairs', '')
    for (const item of edition.overlaps) lines.push(`- **${item.leftHeadline}** ↔ **${item.rightHeadline}** — similarity ${item.similarity}${item.sharedUrls.length ? '; shared source URL' : ''}`)
    lines.push('')
  }
  lines.push('## Ranked accepted cards', '')
  for (const card of edition.cards) {
    lines.push(`### ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane} · regions: ${card.priorityRegions.join(', ') || 'broader world'}`, '')
    for (const page of card.pages) lines.push(page.text, '')
    if (card.uncertainties.length) lines.push(`Uncertainties: ${card.uncertainties.join(' · ')}`, '')
    lines.push(card.image?.url ? `Image: [${card.image.publisher}](${card.image.url})` : 'Image: none — approved high-value exception after recovery was exhausted', '', `Sources: ${card.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), get = name => args[args.indexOf(name) + 1]
  const reportPath = get('--writer-report'), shortlistPath = get('--shortlist'), outputDir = get('--output-dir')
  if (!reportPath || !shortlistPath || !outputDir) throw new Error('--writer-report, --shortlist and --output-dir are required')
  const [report, shortlist] = await Promise.all([reportPath, shortlistPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'UNATTENDED_SHADOW_EDITION.json'), `${JSON.stringify(edition, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'UNATTENDED_SHADOW_EDITION.md'), markdown(edition)),
  ])
  process.stdout.write(`${JSON.stringify({ requested: edition.requested, accepted: edition.accepted, rejected: edition.rejected.length, overlapFlags: edition.overlaps.length, requiresEditorialReview: edition.requiresEditorialReview, laneCounts: edition.audit.laneCounts, regionCounts: edition.audit.regionCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
