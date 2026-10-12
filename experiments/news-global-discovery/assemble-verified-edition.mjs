import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { rankFrontPage } from './final-edition-ranker.mjs'
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
  const options = { shortlist: null, verification: null, repair: null, outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--shortlist') options.shortlist = argv[++index]
    else if (argv[index] === '--verification') options.verification = argv[++index]
    else if (argv[index] === '--repair') options.repair = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if (Object.values(options).some(value => !value)) throw new Error('--shortlist, --verification, --repair and --output-dir are required')
  return options
}

function unique(values) { return [...new Set(values.filter(Boolean))] }

export function verifiedEventIds(verification, repair) {
  return new Set([
    ...verification.ready.map(item => item.eventId),
    ...repair.results.filter(item => item.readiness.ready).map(item => item.eventId),
  ])
}

function verifiedItem(eventId, verification, repair) {
  return repair.results.find(item => item.eventId === eventId && item.readiness.ready)
    || verification.ready.find(item => item.eventId === eventId)
}

export function assembleVerifiedCards(shortlist, verification, repair) {
  const ids = verifiedEventIds(verification, repair)
  return shortlist.selections.filter(selection => ids.has(selection.id)).flatMap((selection, index) => {
    const verified = verifiedItem(selection.id, verification, repair)
    const acceptedSources = verified.sources.filter(source => source.accepted
      && !headlinesExplicitlyConflict({ title: selection.representative.title }, { title: source.title || '' })
      && (candidatesDescribeSameThread({ title: selection.representative.title }, { title: source.title || '' }) || (source.sharedTerms || []).length >= 4))
    if (!acceptedSources.length) return []
    if (verified.readiness.highRisk && unique(acceptedSources.map(source => source.family)).length < 2) return []
    const imageSource = acceptedSources.find(source => source.url === verified.readiness.image?.sourceUrl && source.imageUrl)
      || acceptedSources.find(source => source.imageUrl)
    if (!imageSource) return []
    const image = { url: imageSource.imageUrl, alt: imageSource.imageAlt || selection.representative.title, sourceUrl: imageSource.url, publisher: imageSource.domain }
    const matchingMembers = selection.members.filter(member => candidatesDescribeSameThread(selection.representative, member))
    const regions = unique(matchingMembers.flatMap(member => member.priorityRegions || []))
    const evidence = acceptedSources.map(source => source.evidenceText || '').filter(Boolean).join('\n\n').slice(0, 10_000)
    return [{
      eventId: selection.id,
      headline: selection.representative.title,
      lane: selection.assignedLane,
      publishedAt: selection.representative.publishedAt,
      priorityRegions: regions,
      image,
      primaryUrl: image?.sourceUrl || acceptedSources[0]?.url || selection.representative.url,
      pages: [{ text: evidence }],
      acceptedSources: acceptedSources.map(source => ({ domain: source.domain, family: source.family, url: source.url, publishedAt: source.publishedAt })),
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
  const [shortlist, verification, repair] = await Promise.all([
    fs.readFile(options.shortlist, 'utf8').then(JSON.parse),
    fs.readFile(options.verification, 'utf8').then(JSON.parse),
    fs.readFile(options.repair, 'utf8').then(JSON.parse),
  ])
  const cards = rankFrontPage(assembleVerifiedCards(shortlist, verification, repair))
  const audit = auditEdition(cards, shortlist.laneLimits || DEFAULT_LANE_LIMITS, shortlist.priorityRegionMinimums || DEFAULT_REGION_MINIMUMS)
  const cardIds = new Set(cards.map(card => card.eventId))
  const excludedAfterContaminationCheck = shortlist.selections
    .filter(selection => verifiedEventIds(verification, repair).has(selection.id) && !cardIds.has(selection.id))
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
