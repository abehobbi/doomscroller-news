import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditCard } from './writer-shortlist-trial.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'

function imageIndex(shortlists) {
  return new Map(shortlists.flatMap(shortlist => (shortlist.selected || shortlist.cards || []))
    .filter(item => item.eventId && item.image?.url)
    .map(item => [item.eventId, item.image]))
}

export function assembleCompleteShadowEdition({ baselineReport, baselineShortlist, replacementReport, replacementInput, replacementFinalists }) {
  const baseline = (baselineReport.results || []).filter(result => result.status === 'accepted')
  const replacementItems = new Map((replacementInput.items || []).map(item => [item.eventId, item]))
  const replacements = (replacementReport.results || []).map(result => {
    const item = replacementItems.get(result.eventId)
    if (!item) throw new Error(`Missing replacement input for ${result.eventId}`)
    const audited = auditCard(item, result.card)
    if (!audited.valid) throw new Error(`Replacement ${result.eventId} still fails: ${Object.entries(audited.audits).filter(([, value]) => value?.valid === false).map(([key]) => key).join(', ')}`)
    return { ...result, status: 'accepted', audits: audited.audits, generationPass: 'replacement' }
  })
  const all = [...baseline.map(result => ({ ...result, generationPass: result.generationPass || 'baseline' })), ...replacements]
  const ids = all.map(result => result.eventId)
  if (new Set(ids).size !== ids.length) throw new Error('Complete edition contains duplicate event ids')
  if (all.length !== Number(baselineReport.expected || 35)) throw new Error(`Expected ${baselineReport.expected || 35} cards, found ${all.length}`)
  const images = imageIndex([baselineShortlist, replacementFinalists])
  const cards = all.map(result => {
    const image = images.get(result.eventId)
    if (!image?.url) throw new Error(`Missing publisher image for ${result.eventId}`)
    return { eventId: result.eventId, lane: result.lane, headline: result.card.headline, pages: result.card.pages, uncertainties: result.card.uncertainties || [], sources: result.sources, image, audits: result.audits, provider: result.provider, generationPass: result.generationPass }
  })
  const ranked = rankFrontPage(cards)
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), shadowOnly: true,
    cardCount: ranked.length, everyCardAccepted: true, everyCardHasPublisherImage: ranked.every(card => Boolean(card.image?.url)),
    laneCounts: Object.fromEntries([...new Set(ranked.map(card => card.lane))].map(lane => [lane, ranked.filter(card => card.lane === lane).length])),
    replacementCount: replacements.length,
    cards: ranked,
  }
}

function markdown(edition) {
  const lines = ['# Complete 35-card News shadow edition', '', 'Review artifact only. Nothing here has been published to Doomscroller or Beta.', '', `Cards: ${edition.cardCount}; replacements: ${edition.replacementCount}; publisher images: ${edition.everyCardHasPublisherImage}.`, '']
  for (const card of edition.cards) {
    lines.push(`## ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane} · generation: ${card.generationPass} · rank score: ${card.frontPageRanking.score}`, '')
    for (const page of card.pages) lines.push(page.text, '')
    if (card.uncertainties.length) lines.push(`Uncertainties: ${card.uncertainties.join(' · ')}`, '')
    lines.push(`Image: [${card.image.publisher}](${card.image.url})`, '', `Sources: ${card.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
  const required = ['--baseline-report', '--baseline-shortlist', '--replacement-report', '--replacement-input', '--replacement-finalists', '--output-dir']
  if (required.some(name => !args.includes(name))) throw new Error(`Required: ${required.join(' ')}`)
  const read = file => fs.readFile(file, 'utf8').then(JSON.parse)
  const [baselineReport, baselineShortlist, replacementReport, replacementInput, replacementFinalists] = await Promise.all(required.slice(0, 5).map(name => read(option(name))))
  const edition = assembleCompleteShadowEdition({ baselineReport, baselineShortlist, replacementReport, replacementInput, replacementFinalists })
  const outputDir = option('--output-dir')
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'COMPLETE_SHADOW_EDITION.json'), `${JSON.stringify(edition, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'COMPLETE_SHADOW_EDITION.md'), markdown(edition), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ cardCount: edition.cardCount, laneCounts: edition.laneCounts, replacementCount: edition.replacementCount, top: edition.cards.slice(0, 5).map(card => card.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
