import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { candidatesDescribeSameThread, headlinesShareNamedLocationAndEvent } from './select-five-lane-edition.mjs'

const STOP = new Set('the a an and or of to in on for with as at by from is are was were be been this that it its their they he she his her have has had will would could should after before amid into over under about'.split(' '))
const tokens = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/ +/).filter(word => word.length > 3 && !STOP.has(word)))
const cardText = card => [card.headline, ...(card.pages || []).map(page => page.text)].join(' ')
const canonical = value => { try { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|at_|traffic_source|fbclid)/i.test(key)) url.searchParams.delete(key); return url.toString() } catch { return String(value || '') } }

export function auditEditorialOverlap(cards, threshold = 0.16) {
  const pairs = []
  for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
    const a = cards[left], b = cards[right]
    const aUrls = new Set((a.sources || []).map(source => canonical(source.url))), bUrls = new Set((b.sources || []).map(source => canonical(source.url)))
    const sharedUrls = [...aUrls].filter(url => bUrls.has(url))
    const aTerms = tokens(cardText(a)), bTerms = tokens(cardText(b)), intersection = [...aTerms].filter(term => bTerms.has(term)).length
    const similarity = intersection / Math.max(1, aTerms.size + bTerms.size - intersection)
    const headlineThreadMatch = headlinesShareNamedLocationAndEvent({ title: a.headline }, { title: b.headline })
    const eventThreadMatch = candidatesDescribeSameThread({ title: a.headline }, { title: b.headline })
    if (sharedUrls.length || similarity >= threshold || headlineThreadMatch || eventThreadMatch) pairs.push({
      leftEventId: a.eventId,
      rightEventId: b.eventId,
      leftHeadline: a.headline,
      rightHeadline: b.headline,
      sharedUrls,
      similarity: Number(similarity.toFixed(3)),
      headlineThreadMatch,
      eventThreadMatch,
      requiresReview: true,
    })
  }
  return pairs
}

export function qualifyShadowEdition(edition, decisions) {
  const byId = new Map((decisions.decisions || []).map(decision => [decision.eventId, decision]))
  const removed = [], trimmed = []
  const cards = edition.cards.flatMap(card => {
    const decision = byId.get(card.eventId)
    if (decision?.action === 'remove') { removed.push({ eventId: card.eventId, headline: card.headline, reason: decision.reason, retainedEventId: decision.retainedEventId || null }); return [] }
    if (decision?.action === 'retain-pages') {
      const pages = decision.pages.map(index => card.pages[index]).filter(Boolean)
      if (!pages.length) throw new Error(`Page decision emptied ${card.eventId}`)
      trimmed.push({ eventId: card.eventId, headline: card.headline, reason: decision.reason, originalPages: card.pages.length, retainedPages: pages.length })
      return [{ ...card, pages }]
    }
    return [card]
  })
  const ranked = rankFrontPage(cards)
  const unresolvedOverlap = auditEditorialOverlap(ranked).filter(pair => !removed.some(item => item.eventId === pair.leftEventId || item.eventId === pair.rightEventId))
  return { ...edition, createdAt: new Date().toISOString(), qualification: 'editorially-qualified-shadow', cardCount: ranked.length, removed, trimmed, unresolvedOverlap, cards: ranked }
}

function markdown(edition) {
  const lines = ['# Editorially qualified News shadow edition', '', 'Review artifact only. Nothing here has been published to Doomscroller or Beta.', '', `Cards: ${edition.cardCount}; unresolved overlap pairs: ${edition.unresolvedOverlap.length}.`, '']
  if (edition.removed.length) { lines.push('## Consolidated or removed during editorial review', ''); for (const item of edition.removed) lines.push(`- ${item.headline}: ${item.reason}`); lines.push('') }
  if (edition.trimmed.length) { lines.push('## Trimmed during editorial review', ''); for (const item of edition.trimmed) lines.push(`- ${item.headline}: ${item.reason}`); lines.push('') }
  for (const card of edition.cards) {
    lines.push(`## ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane}`, '')
    for (const page of card.pages) lines.push(page.text, '')
    lines.push(`Image: [${card.image.publisher}](${card.image.url})`, '', `Sources: ${card.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), get = name => args[args.indexOf(name) + 1]
  if (!args.includes('--input') || !args.includes('--decisions') || !args.includes('--output-dir')) throw new Error('--input, --decisions and --output-dir are required')
  const [edition, decisions] = await Promise.all([get('--input'), get('--decisions')].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const overlap = auditEditorialOverlap(edition.cards)
  const qualified = qualifyShadowEdition(edition, decisions)
  const outputDir = get('--output-dir'); await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'EDITORIAL_OVERLAP_AUDIT.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), threshold: 0.16, pairs: overlap }, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'QUALIFIED_SHADOW_EDITION.json'), `${JSON.stringify(qualified, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'QUALIFIED_SHADOW_EDITION.md'), markdown(qualified)),
  ])
  process.stdout.write(`${JSON.stringify({ before: edition.cardCount, after: qualified.cardCount, detectedPairs: overlap.length, unresolvedPairs: qualified.unresolvedOverlap.length, top: qualified.cards.slice(0, 5).map(card => card.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
