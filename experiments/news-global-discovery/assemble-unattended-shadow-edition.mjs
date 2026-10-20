import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { auditEditorialOverlap } from './qualify-shadow-edition.mjs'
import { regionMatchesText } from './merge-discovery-candidates.mjs'

const PRIORITY_REGIONS = ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']
const BREAKING_MAJOR_HEADLINE = /\b(?:kills? (?:at least )?\d+|\d+ (?:people )?(?:killed|dead)|dozens? (?:killed|dead)|declares? (?:a )?(?:national )?state of emergency|magnitude-\d+(?:\.\d+)? earthquake|hurricane makes landfall)\b/i
const UNAMBIGUOUS_EVIDENCE_REGION = {
  Syria: /\b(?:syria|syrian|damascus|aleppo|homs|hama|idlib|latakia|tartous|daraa|deir ez-zor|raqqa|sweida|hasakah)\b/i,
  'Middle East': /\b(?:middle east|iran|iranian|iraq|iraqi|israel|israeli|palestin|gaza|west bank|leban|yemen|houthi|saudi|riyadh|qatar|emirat|uae|oman|bahrain|kuwait|turk(?:ey|iye)|amman|jordanian)\b/i,
  Bangladesh: /\b(?:bangladesh|bangladeshi|dhaka|chattogram|chittagong|sylhet|rajshahi|khulna|barisal|rangpur|mymensingh|mongla|padma|bnp|awami league)\b/i,
  Ghana: /\b(?:ghana|ghanaian|accra|tema|kumasi|tamale|takoradi|cape coast|ashanti|bawumia|mahama)\b/i,
  Canada: /(?:\b(?:canada|canadian|ontario|quebec|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|british columbia|yukon|nunavut|toronto|montreal|vancouver|ottawa|calgary|edmonton)\b|\bb\.c\.(?=\s|$|[,;:]))/i,
  GTA: /\b(?:greater toronto|gta|toronto|mississauga|brampton|markham|vaughan|scarborough|etobicoke|pickering|ajax|oshawa|oakville|burlington|durham region|durham,? ontario)\b/i,
}

function regionMatchesGeneratedContext(region, headlineContext, evidence) {
  const centralEvidence = String(evidence || '').slice(0, 1600).replace(/\bKunming-Montreal\b/gi, '')
  return regionMatchesText(region, headlineContext) || UNAMBIGUOUS_EVIDENCE_REGION[region]?.test(centralEvidence)
}

export function normalizeGeneratedRouting(lane, priorityRegions, headline, sourceHeadline = '', sourceEvidence = '') {
  const headlineContext = `${sourceHeadline} ${headline}`
  const confirmed = (priorityRegions || []).filter(region => regionMatchesText(region, headlineContext)
    || UNAMBIGUOUS_EVIDENCE_REGION[region]?.test(String(sourceEvidence || '').replace(/\bKunming-Montreal\b/gi, '')))
  const inferred = PRIORITY_REGIONS.filter(region => regionMatchesGeneratedContext(region, headlineContext, sourceEvidence))
  const regions = [...new Set([...confirmed, ...inferred])]
  const broadMiddleEastIndex = regions.indexOf('Middle East')
  if (regions.includes('Syria') && broadMiddleEastIndex >= 0) regions.splice(broadMiddleEastIndex, 1)
  let normalizedLane = lane
  if (regions.length && lane === 'world-major') normalizedLane = 'priority-major'
  if (regions.length && lane === 'world-interesting') normalizedLane = 'priority-interesting'
  if (!regions.length && lane === 'priority-major') normalizedLane = 'world-major'
  if (!regions.length && lane === 'priority-interesting') normalizedLane = 'world-interesting'
  if (BREAKING_MAJOR_HEADLINE.test(headline) && normalizedLane === 'world-interesting') normalizedLane = 'world-major'
  if (BREAKING_MAJOR_HEADLINE.test(headline) && normalizedLane === 'priority-interesting') normalizedLane = 'priority-major'
  return { lane: normalizedLane, priorityRegions: regions }
}

export function rejectionCategory(result) {
  if (result.status === 'deferred' || result.provider?.structuralStatus === 'provider_deferred') return 'provider-deferred'
  const quotaDeferred = result.provider?.httpStatus === 429
    || (result.provider?.internalErrors || []).some(error => Number(error.code) === 4006)
  if (quotaDeferred) return 'provider-deferred'
  if (result.provider?.structuralStatus === 'provider_failure') return 'provider-failure'
  if (result.provider?.structuralStatus === 'writer_input_evidence_preflight_failure') return 'input-rejected'
  return 'check-rejected'
}

export function failedAuditChecks(audits = {}) {
  return Object.entries(audits)
    .filter(([, value]) => value?.valid === false || value?.passes === false)
    .map(([name]) => name)
}

export function assembleUnattendedShadowEdition(writerReport, shortlist) {
  const inputs = new Map((shortlist.selected || []).map(item => [item.eventId, item]))
  const accepted = (writerReport.results || []).filter(result => result.status === 'accepted')
  const rejected = (writerReport.results || []).filter(result => result.status !== 'accepted').map(result => ({
    eventId: result.eventId,
    sourceTitle: result.sourceTitle,
    failedChecks: failedAuditChecks(result.audits),
    complete: Boolean(result.provider?.complete),
    category: rejectionCategory(result),
    providerStatus: result.provider?.httpStatus || null,
    providerCode: result.provider?.internalErrors?.[0]?.code || null,
  }))
  const rankedCards = rankFrontPage(accepted.map(result => {
    const input = inputs.get(result.eventId)
    if (!input?.image?.url && !input?.imageException?.granted) throw new Error(`Accepted card ${result.eventId} has neither a verified publisher image nor an approved image exception`)
    const routing = normalizeGeneratedRouting(result.lane, input.priorityRegions, result.card.headline, input.headline, input.evidence)
    return {
      eventId: result.eventId,
      lane: routing.lane,
      headline: result.card.headline,
      publishedAt: input.publishedAt,
      priorityRegions: routing.priorityRegions,
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
    category: 'overlap-rejected',
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
    providerDeferred: rejected.filter(item => item.category === 'provider-deferred').length,
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
  const providerDeferred = edition.rejected.filter(item => item.category === 'provider-deferred')
  const checkRejected = edition.rejected.filter(item => item.category !== 'provider-deferred')
  if (providerDeferred.length) {
    lines.push('## Deferred by provider availability', '')
    for (const item of providerDeferred) lines.push(`- **${item.sourceTitle}** — HTTP ${item.providerStatus || 'unknown'}, provider code ${item.providerCode || 'unknown'}`)
    lines.push('')
  }
  if (checkRejected.length) {
    lines.push('## Rejected by deterministic checks', '')
    for (const item of checkRejected) {
      const reason = item.category === 'input-rejected'
        ? 'writer input failed the evidence preflight'
        : item.complete ? item.failedChecks.join(', ') || 'unclassified deterministic check' : 'incomplete provider output'
      lines.push(`- **${item.sourceTitle}** — ${reason}`)
    }
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
  process.stdout.write(`${JSON.stringify({ requested: edition.requested, accepted: edition.accepted, rejected: edition.rejected.length, providerDeferred: edition.providerDeferred, overlapFlags: edition.overlaps.length, requiresEditorialReview: edition.requiresEditorialReview, laneCounts: edition.audit.laneCounts, regionCounts: edition.audit.regionCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
