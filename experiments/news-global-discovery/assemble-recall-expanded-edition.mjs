import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { rankFrontPage } from './final-edition-ranker.mjs'

const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') } }

export function assembleRecallExpandedEdition(baseline, writerReport, shortlist) {
  const shortlisted = new Map((shortlist.selected || []).map(item => [item.eventId, item]))
  const accepted = (writerReport.results || []).filter(result => result.status === 'accepted')
  const additions = accepted.map(result => {
    const source = shortlisted.get(result.eventId)
    if (!source?.image?.url) throw new Error(`${result.eventId} has no verified image`)
    return {
      eventId: result.eventId,
      headline: result.card.headline,
      lane: result.lane,
      publishedAt: source.publishedAt,
      priorityRegions: source.priorityRegions || [],
      image: source.image,
      primaryUrl: source.primarySource.url,
      pages: result.card.pages,
      uncertainties: result.card.uncertainties || [],
      acceptedSources: result.sources.map(item => ({ domain: item.publisher, url: item.url })),
      sources: result.sources,
      audits: result.audits,
      origin: 'targeted-recall',
    }
  })
  const acceptedIds = new Set(additions.map(card => card.eventId))
  const baselineCards = (baseline.cards || []).filter(card => !acceptedIds.has(card.eventId)).map(card => ({ ...card, origin: card.origin || 'verified-baseline' }))
  const eventIds = new Set(), urls = new Set(), duplicates = [], combined = []
  for (const card of [...baselineCards, ...additions]) {
    const url = canonical(card.primaryUrl || card.sources?.[0]?.url || card.acceptedSources?.[0]?.url)
    if (eventIds.has(card.eventId) || (url && urls.has(url))) {
      duplicates.push({ eventId: card.eventId, headline: card.headline, reason: eventIds.has(card.eventId) ? 'duplicate event id' : 'duplicate canonical primary URL' })
      continue
    }
    eventIds.add(card.eventId); if (url) urls.add(url); combined.push(card)
  }
  const cards = rankFrontPage(combined)
  const lanes = ['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']
  const regions = ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), shadowOnly: true,
    baselineCount: baselineCards.length, additionCount: additions.length, cardCount: cards.length,
    laneCounts: Object.fromEntries(lanes.map(lane => [lane, cards.filter(card => card.lane === lane).length])),
    priorityRegionCounts: Object.fromEntries(regions.map(region => [region, cards.filter(card => (card.priorityRegions || []).includes(region)).length])),
    imageComplete: cards.every(card => Boolean(card.image?.url)),
    sourceComplete: cards.every(card => Boolean(card.primaryUrl || card.sources?.length || card.acceptedSources?.length)),
    auditComplete: additions.every(card => Object.values(card.audits || {}).filter(value => value && typeof value === 'object' && 'valid' in value).every(value => value.valid)),
    duplicatesRemoved: duplicates,
    cards,
  }
}

function render(edition) {
  const lines = ['# Recall-expanded News shadow edition', '', 'Review artifact only. This has not been published.', '',
    `Cards: ${edition.cardCount} (${edition.baselineCount} baseline + ${edition.additionCount} targeted-recall additions).`,
    `Images complete: ${edition.imageComplete}. Sources complete: ${edition.sourceComplete}. New-card audits complete: ${edition.auditComplete}.`, '',
    '## Lane balance', '', ...Object.entries(edition.laneCounts).map(([lane, count]) => `- ${lane}: ${count}`), '',
    '## Priority-region coverage', '', ...Object.entries(edition.priorityRegionCounts).map(([region, count]) => `- ${region}: ${count}`), '',
    '## Ranked edition', '']
  for (const card of edition.cards) lines.push(`### ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane} · Origin: ${card.origin} · Rank score: ${card.frontPageRanking.score}`, '', `Image: ${card.image.url}`, '')
  if (edition.duplicatesRemoved.length) lines.push('## Exact duplicates removed', '', ...edition.duplicatesRemoved.map(item => `- ${item.headline}: ${item.reason}`), '')
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const baselinePath = value('--baseline'), reportPath = value('--writer-report'), shortlistPath = value('--shortlist'), outputDir = value('--output-dir')
  if (!baselinePath || !reportPath || !shortlistPath || !outputDir) throw new Error('--baseline, --writer-report, --shortlist and --output-dir are required')
  const [baseline, report, shortlist] = await Promise.all([baselinePath, reportPath, shortlistPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const edition = assembleRecallExpandedEdition(baseline, report, shortlist)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'RECALL_EXPANDED_EDITION.json'), `${JSON.stringify(edition, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'RECALL_EXPANDED_EDITION.md'), render(edition)),
  ])
  process.stdout.write(`${JSON.stringify({ cards: edition.cardCount, additions: edition.additionCount, laneCounts: edition.laneCounts, priorityRegionCounts: edition.priorityRegionCounts, imageComplete: edition.imageComplete, sourceComplete: edition.sourceComplete, auditComplete: edition.auditComplete, duplicatesRemoved: edition.duplicatesRemoved.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
