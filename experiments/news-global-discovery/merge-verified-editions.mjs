import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { candidatesDescribeSameThread, headlinesExplicitlyConflict } from './select-five-lane-edition.mjs'

const canonical = value => {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|at_medium|at_campaign)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}
const sourceCount = card => new Set((card.acceptedSources || []).map(source => source.family || source.domain)).size
const normalizedHeadline = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const mergedEventId = card => `merged-${createHash('sha256').update(canonical(card.primaryUrl) || normalizedHeadline(card.headline)).digest('hex').slice(0, 16)}`
const LOCATION_GROUPS = [/\b(?:riyadh|saudi(?: arabia)?)\b/i, /\b(?:dhaka|bangladesh)\b/i, /\b(?:kyiv|ukraine)\b/i]
const INFRASTRUCTURE_GROUPS = [/\bairports?\b/i, /\bports?\b/i, /\bpower plants?\b/i, /\bhospitals?\b/i]
const CAUSE_EVENT = /\b(?:attack(?:ed|s)?|strike[sd]?|explosion|fire|earthquake|flood|storm|outage)\b/i
const DIRECT_CONSEQUENCE = /\b(?:closure|closed|disrupt(?:ed|s|ion)?|cancel(?:led|ed|s|lation)?|suspend(?:ed|s|ing)?|delay(?:ed|s)?|evacuat(?:e|ed|ion)|flights?|passengers?|outage)\b/i

function linkedInfrastructureConsequence(left, right) {
  const leftTitle = String(left.headline || ''), rightTitle = String(right.headline || '')
  const sharedPlace = LOCATION_GROUPS.some(pattern => pattern.test(leftTitle) && pattern.test(rightTitle))
  const sharedInfrastructure = INFRASTRUCTURE_GROUPS.some(pattern => pattern.test(leftTitle) && pattern.test(rightTitle))
  if (!sharedPlace || !sharedInfrastructure) return false
  const context = card => `${card.headline || ''} ${(card.pages?.[0]?.text || '').slice(0, 1600)}`
  const leftContext = context(left), rightContext = context(right)
  const hasDirectionalLink = (
    CAUSE_EVENT.test(leftTitle) && DIRECT_CONSEQUENCE.test(rightTitle) && CAUSE_EVENT.test(rightContext)
  ) || (
    CAUSE_EVENT.test(rightTitle) && DIRECT_CONSEQUENCE.test(leftTitle) && CAUSE_EVENT.test(leftContext)
  )
  return hasDirectionalLink && candidatesDescribeSameThread({ title: leftContext }, { title: rightContext })
}

function linkedCurrencyInvestment(left, right) {
  const context = card => `${card.headline || ''} ${(card.pages?.[0]?.text || '').slice(0, 1600)}`
  const leftContext = context(left), rightContext = context(right)
  const currency = /(?:[$£€]|\b(?:tk|bdt|usd|cad|eur|gbp|yen)\b)/i
  const investment = /\binvest(?:ment|s|ed|ing)?\b/i
  return currency.test(leftContext) && currency.test(rightContext)
    && investment.test(leftContext) && investment.test(rightContext)
    && candidatesDescribeSameThread({ title: leftContext }, { title: rightContext })
}

function sameEvent(left, right) {
  if (canonical(left.primaryUrl) && canonical(left.primaryUrl) === canonical(right.primaryUrl)) return true
  if (normalizedHeadline(left.headline) && normalizedHeadline(left.headline) === normalizedHeadline(right.headline)) return true
  if (linkedInfrastructureConsequence(left, right)) return true
  if (linkedCurrencyInvestment(left, right)) return true
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
  const cards = clusters.map(cluster => {
    const acceptedSources = [...new Map(cluster.members.flatMap(member => member.acceptedSources || []).map(source => [canonical(source.url), source])).values()]
    return {
      ...cluster.representative,
      eventId: mergedEventId(cluster.representative),
      priorityRegions: [...new Set(cluster.members.flatMap(member => member.priorityRegions || []))],
      acceptedSources,
      sourceEventIds: [...new Set(cluster.members.map(member => member.eventId).filter(Boolean))],
    }
  })
  const ranked = rankFrontPage(cards), audit = auditEdition(ranked)
  const starts = editions.map(edition => edition.requestedWindow?.start).filter(Boolean).sort()
  const ends = editions.map(edition => edition.requestedWindow?.end).filter(Boolean).sort()
  const requestedWindow = starts.length && ends.length ? { start: starts[0], end: ends.at(-1) } : null
  return { schemaVersion: 1, createdAt: new Date().toISOString(), requestedWindow, sourceEditionCount: editions.length, cards: ranked, audit }
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
