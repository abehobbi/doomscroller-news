import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { rankFrontPage } from './final-edition-ranker.mjs'
import { sourceFamilyFromEvidence } from './event-corroboration.mjs'
import { readiness } from './verify-unified-shortlist.mjs'
import { candidatesDescribeSameThread, headlinesExplicitlyConflict } from './select-five-lane-edition.mjs'

const DEFAULT_LANE_LIMITS = {
  'world-major': { minimum: 10, preferred: 12, maximum: 15 },
  'priority-major': { minimum: 8, preferred: 12, maximum: 15 },
  'world-interesting': { minimum: 10, preferred: 15, maximum: 20 },
  'priority-interesting': { minimum: 6, preferred: 10, maximum: 15 },
  discovery: { minimum: 4, preferred: 6, maximum: 8 },
}
const DEFAULT_REGION_MINIMUMS = { Syria: 2, 'Middle East': 2, Bangladesh: 2, Ghana: 2, Canada: 2, GTA: 1 }

function parseArgs(argv) {
  const options = { shortlist: null, verification: null, repairs: [], outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--shortlist') options.shortlist = argv[++index]
    else if (argv[index] === '--verification') options.verification = argv[++index]
    else if (argv[index] === '--repair') options.repairs.push(argv[++index])
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if (!options.shortlist || !options.verification || !options.repairs.length || !options.outputDir) throw new Error('--shortlist, --verification, at least one --repair, and --output-dir are required')
  return options
}

function unique(values) { return [...new Set(values.filter(Boolean))] }

function repairReports(value) { return Array.isArray(value) ? value : [value] }

const IMAGE_EXCEPTION_REASON = 'no verified publisher image recovered'
const IMAGE_EXCEPTION_MIN_SCORE = 125
const IMAGE_EXCEPTION_LIMIT = 2

export function imageExceptionIds(verification, repairs, { minimumScore = IMAGE_EXCEPTION_MIN_SCORE, limit = IMAGE_EXCEPTION_LIMIT } = {}) {
  const attemptedRepairs = repairReports(repairs).flatMap(repair => repair.results || [])
  return new Set(attemptedRepairs
    .filter(item => item.readiness?.reasons?.length === 1
      && item.readiness.reasons[0] === IMAGE_EXCEPTION_REASON
      && item.repair?.requestId
      && Number(item.selectionScore || 0) >= minimumScore
      && Number(item.readiness.trustedSourceFamilies || 0) >= 1
      && Number(item.readiness.acceptedSourceCount || 0) >= 1)
    .sort((a, b) => Number(b.selectionScore || 0) - Number(a.selectionScore || 0))
    .slice(0, limit)
    .map(item => item.eventId))
}

export function verifiedEventIds(verification, repairs, imageExceptions = imageExceptionIds(verification, repairs)) {
  return new Set([
    ...verification.ready.map(item => item.eventId),
    ...repairReports(repairs).flatMap(repair => repair.results.filter(item => item.readiness.ready).map(item => item.eventId)),
    ...imageExceptions,
  ])
}

function verifiedItem(eventId, verification, repairs) {
  return repairReports(repairs).toReversed().flatMap(repair => repair.results).find(item => item.eventId === eventId && item.readiness.ready)
    || verification.ready.find(item => item.eventId === eventId)
    || repairReports(repairs).toReversed().flatMap(repair => repair.results).find(item => item.eventId === eventId)
    || (verification.repairQueue || []).find(item => item.eventId === eventId)
}

export function assembleVerifiedCards(shortlist, verification, repairs) {
  const exceptions = imageExceptionIds(verification, repairs)
  const ids = verifiedEventIds(verification, repairs, exceptions)
  return shortlist.selections.filter(selection => ids.has(selection.id)).flatMap((selection, index) => {
    const verified = verifiedItem(selection.id, verification, repairs)
    const acceptedSources = verified.sources.filter(source => source.accepted && source.trusted
      && !headlinesExplicitlyConflict({ title: selection.representative.title }, { title: source.title || '' })
      && (candidatesDescribeSameThread({ title: selection.representative.title }, { title: source.title || '' }) || (source.sharedTerms || []).length >= 4))
      .map(source => ({ ...source, family: sourceFamilyFromEvidence(source.domain, source.evidenceText, source.title) }))
    if (!acceptedSources.length) return []
    const finalGate = readiness({ representative: { title: selection.representative.title } }, acceptedSources.map(source => ({ ...source, accepted: true })))
    const isImageException = exceptions.has(selection.id)
    if (!finalGate.ready && !(isImageException && finalGate.reasons.length === 1 && finalGate.reasons[0] === IMAGE_EXCEPTION_REASON)) return []
    const imageSource = acceptedSources.find(source => source.url === verified.readiness.image?.sourceUrl && source.imageUrl)
      || acceptedSources.find(source => source.imageUrl)
    if (!imageSource && !isImageException) return []
    const image = imageSource ? { url: imageSource.imageUrl, alt: imageSource.imageAlt || selection.representative.title, sourceUrl: imageSource.url, publisher: imageSource.domain } : null
    const matchingMembers = selection.members.filter(member => candidatesDescribeSameThread(selection.representative, member))
    const regions = unique([...(selection.representative.priorityRegions || []), ...matchingMembers.flatMap(member => member.priorityRegions || [])])
    const evidence = acceptedSources.map(source => source.evidenceText || '').filter(Boolean).join('\n\n').slice(0, 10_000)
    return [{
      eventId: selection.id,
      headline: selection.representative.title,
      lane: selection.assignedLane,
      publishedAt: selection.representative.publishedAt,
      priorityRegions: regions,
      image,
      imageException: isImageException ? { granted: true, reason: 'Exceptional editorial value outweighed the visual gap after a completed publisher-image recovery search found no usable image.' } : null,
      primaryUrl: image?.sourceUrl || acceptedSources[0]?.url || selection.representative.url,
      pages: [{ text: evidence }],
      acceptedSources: acceptedSources.map(source => ({
        domain: source.domain, family: source.family, url: source.url,
        title: source.title || selection.representative.title,
        publishedAt: source.publishedAt,
        evidenceText: source.evidenceText || '',
      })),
      shortlistOrder: index + 1,
      selectionScore: selection.adjustedScore,
    }]
  })
}

export function auditEdition(cards, laneLimits = DEFAULT_LANE_LIMITS, regionMinimums = DEFAULT_REGION_MINIMUMS) {
  const laneCounts = Object.fromEntries(Object.keys(laneLimits).map(lane => [lane, cards.filter(card => card.lane === lane).length]))
  const regionCounts = Object.fromEntries(Object.keys(regionMinimums).map(region => [region, cards.filter(card => card.priorityRegions.includes(region)).length]))
  const laneGaps = Object.fromEntries(Object.entries(laneLimits).map(([lane, limits]) => [lane, Math.max(0, limits.minimum - laneCounts[lane])]).filter(([, gap]) => gap))
  const regionGaps = Object.fromEntries(Object.entries(regionMinimums).map(([region, minimum]) => [region, Math.max(0, minimum - regionCounts[region])]).filter(([, gap]) => gap))
  const publisherCounts = {}
  for (const card of cards) for (const domain of unique(card.acceptedSources.map(source => source.domain))) publisherCounts[domain] = (publisherCounts[domain] || 0) + 1
  return { total: cards.length, laneCounts, regionCounts, laneGaps, regionGaps, publisherCounts }
}

function markdown(output) {
  const { audit, cards, excludedAfterContaminationCheck } = output
  const lines = [
    '# Provisional verified News edition', '',
    `Created: ${output.createdAt}`, '',
    `${cards.length} verified stories. This is a ranking and gap audit, not generated card copy.`, '',
    '## Balance audit', '',
    `Lane counts: ${Object.entries(audit.laneCounts).map(([name, count]) => `${name} ${count}`).join(' · ')}`, '',
    `Priority-region counts: ${Object.entries(audit.regionCounts).map(([name, count]) => `${name} ${count}`).join(' · ')}`, '',
    `Lane minimum gaps: ${Object.keys(audit.laneGaps).length ? Object.entries(audit.laneGaps).map(([name, count]) => `${name} +${count}`).join(' · ') : 'none'}`, '',
    `Priority-region minimum gaps: ${Object.keys(audit.regionGaps).length ? Object.entries(audit.regionGaps).map(([name, count]) => `${name} +${count}`).join(' · ') : 'none'}`, '',
    `Excluded after cross-event contamination check: ${excludedAfterContaminationCheck.length}`, '',
    ...excludedAfterContaminationCheck.flatMap(item => [`- ${item.headline}`, `  - ${item.reason}`]),
    ...(excludedAfterContaminationCheck.length ? [''] : []),
    '## Provisional feed order', '',
  ]
  for (const card of cards) {
    lines.push(`### ${card.frontPageRank}. ${card.headline}`, '', `Lane: ${card.lane} · regions: ${card.priorityRegions.join(', ') || 'broader world'} · ranking score: ${card.frontPageRanking.score}`, '', `Sources: ${unique(card.acceptedSources.map(source => source.domain)).join(', ')}`, '')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [shortlist, verification, ...repairs] = await Promise.all([
    fs.readFile(options.shortlist, 'utf8').then(JSON.parse),
    fs.readFile(options.verification, 'utf8').then(JSON.parse),
    ...options.repairs.map(file => fs.readFile(file, 'utf8').then(JSON.parse)),
  ])
  const cards = rankFrontPage(assembleVerifiedCards(shortlist, verification, repairs))
  const audit = auditEdition(cards, shortlist.laneLimits || DEFAULT_LANE_LIMITS, shortlist.priorityRegionMinimums || DEFAULT_REGION_MINIMUMS)
  const cardIds = new Set(cards.map(card => card.eventId))
  const excludedAfterContaminationCheck = shortlist.selections
    .filter(selection => verifiedEventIds(verification, repairs).has(selection.id) && !cardIds.has(selection.id))
    .map(selection => ({ eventId: selection.id, headline: selection.representative.title, reason: 'valid supporting evidence fell below the final same-event source or image requirement after removing unrelated cluster members' }))
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), sources: options, audit, excludedAfterContaminationCheck, cards }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'VERIFIED_EDITION.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(options.outputDir, 'VERIFIED_EDITION.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ total: audit.total, laneCounts: audit.laneCounts, regionCounts: audit.regionCounts, laneGaps: audit.laneGaps, regionGaps: audit.regionGaps, topFive: cards.slice(0, 5).map(card => card.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
