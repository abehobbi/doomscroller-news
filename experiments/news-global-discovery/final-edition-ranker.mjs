import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAJOR_LANES = new Set(['world-major', 'priority-major'])
const LANE_BASE = { 'world-major': 60, 'priority-major': 60, 'world-interesting': 24, 'priority-interesting': 26, discovery: 20 }
const MASS_CASUALTY = /\b(?:attack|strike|bomb(?:ing)?|earthquake|flood|landslide|hurricane|outbreak|war)\b[\s\S]{0,180}\b(?:kill(?:ed|s)?|dead|deaths?|wound(?:ed|s)?|injur(?:ed|ies))\b|\b(?:kill(?:ed|s)?|dead|deaths?|wound(?:ed|s)?|injur(?:ed|ies))\b[\s\S]{0,180}\b(?:attack|strike|bomb(?:ing)?|earthquake|flood|landslide|hurricane|outbreak|war)\b/i
const LARGE_HUMAN_SCALE = /\b(?:million|hundreds? of thousands?|thousands?|\d{3,})\b[\s\S]{0,100}\b(?:affected|displaced|detained|evacuated|without|stranded|injured|wounded|dead|killed)\b|\b(?:affected|displaced|detained|evacuated|without|stranded|injured|wounded|dead|killed)\b[\s\S]{0,100}\b(?:million|hundreds? of thousands?|thousands?|\d{3,})\b/i
const ESCALATION = /\b(?:invasion|cross-border|troops?|military escalation|wider war|joins? (?:the )?war|deploy(?:ment|s|ed)?|missile|drone attack|airport attack)\b/i
const SYSTEMIC = /\b(?:election|international criminal court|supreme court|constitutional|sanctions?|ceasefire|trade deal|central bank|unemployment|public health|national strike)\b/i
const PROSPECTIVE = /\b(?:considers?|weighs?|may|might|could|plans? to|proposal|proposed|explores?|expected to)\b/i
const RETROSPECTIVE = /\b(?:anniversary|(?:a|one) year after|years? after|looks back|retrospective)\b/i

function combinedText(card) { return [card.headline, ...(card.pages || []).map(page => page.text)].join(' ') }

function largestExplicitCasualty(text) {
  const values = []
  const pattern = /\b(\d{1,3}(?:,\d{3})*)\s+(?:people\s+)?(?:were\s+)?(?:killed|dead|deaths?|wounded|injured)\b/gi
  for (const match of text.matchAll(pattern)) values.push(Number(match[1].replaceAll(',', '')))
  return values.length ? Math.max(...values) : 0
}

export function scoreFrontPageCard(card) {
  const text = combinedText(card), reasons = []
  let score = LANE_BASE[card.lane] ?? 0
  const isMajor = MAJOR_LANES.has(card.lane)
  const isRetrospective = RETROSPECTIVE.test(card.headline)
  if (isMajor) reasons.push('qualified as major news')
  const casualties = largestExplicitCasualty(text)
  if (isMajor && !isRetrospective && MASS_CASUALTY.test(text)) {
    score += casualties >= 100 ? 38 : casualties >= 25 ? 34 : casualties > 0 ? 26 : 18
    reasons.push(casualties ? `immediate casualties (${casualties} explicitly reported)` : 'immediate casualty event')
  }
  if (isMajor && !isRetrospective && LARGE_HUMAN_SCALE.test(text)) { score += 20; reasons.push('large directly affected population') }
  if (isMajor && !isRetrospective && ESCALATION.test(text)) { score += 18; reasons.push('security escalation risk') }
  if (isMajor && SYSTEMIC.test(text)) { score += 10; reasons.push('systemic institutional or national consequence') }
  if (isMajor && PROSPECTIVE.test(card.headline)) { score -= 14; reasons.push('development remains prospective') }
  if (isMajor && isRetrospective) { score -= 18; reasons.push('retrospective or anniversary framing') }
  return { score, reasons }
}

export function rankFrontPage(cards) {
  return cards.map((card, originalIndex) => ({ ...card, frontPageRanking: { ...scoreFrontPageCard(card), originalIndex: originalIndex + 1 } }))
    .sort((left, right) => right.frontPageRanking.score - left.frontPageRanking.score || left.frontPageRanking.originalIndex - right.frontPageRanking.originalIndex)
    .map((card, index) => ({ ...card, frontPageRank: index + 1 }))
}

function render(cards) {
  const lines = ['# Front-page ranking diagnostic', '', 'This ranking is applied only after stories qualify for an edition. Lane balance controls selection; urgency and consequence control display order.', '']
  for (const card of cards) lines.push(`## ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane} · score: ${card.frontPageRanking.score}`, '', `Why: ${card.frontPageRanking.reasons.join('; ') || 'lane baseline and original editorial order'}`, '')
  return `${lines.join('\n')}\n`
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output-dir')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output-dir are required')
  const input = process.argv[inputIndex + 1], outputDir = process.argv[outputIndex + 1]
  const edition = JSON.parse(await fs.readFile(input, 'utf8')), cards = rankFrontPage(edition.cards || [])
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'FRONT_PAGE_RANKING.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), source: input, cards }, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'FRONT_PAGE_RANKING.md'), render(cards), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ cards: cards.length, top: cards.slice(0, 5).map(card => card.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
