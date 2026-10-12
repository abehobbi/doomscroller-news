import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { buildBoundPacket } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/scope.mjs'
import { validateGeneratedDates } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/temporal.mjs'
import { auditWriterTemporalExposure, buildWriterSafeTemporalPacket } from '../../artifacts/summary-feasibility/writer-safe-temporal-input-fix/writer-safe-temporal.mjs'
import { validateCardContent } from '../../scripts/news-beta/content-validation.mjs'
import { writeCard, WRITER_CONFIGURATION } from '../../scripts/news-beta/writer.mjs'

export const LANES = ['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']
const LABELS = { 'world-major': 'Major world', 'priority-major': 'Major priority region', 'world-interesting': 'Interesting world', 'priority-interesting': 'Interesting priority region', discovery: 'Discovery' }
const REGION_TIMEZONE = { Syria: 'Asia/Damascus', 'Middle East': 'Asia/Qatar', Bangladesh: 'Asia/Dhaka', Ghana: 'Africa/Accra', Canada: 'America/Toronto', GTA: 'America/Toronto' }
const REGION_PRIORITY = { Syria: 5, 'Middle East': 4, Bangladesh: 3, Ghana: 2, Canada: 1, GTA: 1 }

function parseArgs(argv) {
  const options = { shortlist: null, verification: [], context: [], eventIds: [], outputDir: null, dryRun: false, allSelected: false, retryRejected: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--shortlist') options.shortlist = argv[++index]
    else if (argv[index] === '--verification') options.verification.push(argv[++index])
    else if (argv[index] === '--context') options.context.push(argv[++index])
    else if (argv[index] === '--event-id') options.eventIds.push(argv[++index])
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--dry-run') options.dryRun = true
    else if (argv[index] === '--all-selected') options.allSelected = true
    else if (argv[index] === '--retry-rejected') options.retryRejected = true
  }
  if (!options.shortlist || !options.outputDir) throw new Error('--shortlist and --output-dir are required')
  return options
}

const canonicalUrl = value => {
  try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') }
}

export function buildVerificationIndex(reports) {
  const index = new Map()
  for (const report of reports) for (const result of report.results || []) {
    for (const source of result.accepted || []) index.set(canonicalUrl(source.url), source)
  }
  return index
}

export function buildContextIndex(contextFiles) {
  const index = new Map()
  for (const file of contextFiles) for (const addition of file.additions || []) {
    if (!addition.eventId || !addition.url || !addition.publisher || !addition.propositions?.length) continue
    const existing = index.get(addition.eventId) || []
    existing.push(addition)
    index.set(addition.eventId, existing)
  }
  return index
}

const recommendationRank = value => value === 'strong' ? 0 : value === 'baseline-qualified' ? 1 : 2
const regionScore = candidate => Math.max(0, ...(candidate.priorityRegions || []).map(region => REGION_PRIORITY[region] || 0))

export function chooseTrialCandidates(shortlist) {
  return LANES.map(lane => shortlist.selected.filter(value => value.lane === lane).sort((left, right) => {
    const sources = Number(right.independentSourceCount || 0) - Number(left.independentSourceCount || 0)
    if (sources) return sources
    if (lane === 'priority-major' || lane === 'priority-interesting') {
      const region = regionScore(right) - regionScore(left)
      if (region) return region
    }
    return recommendationRank(left.editorialRecommendation) - recommendationRank(right.editorialRecommendation)
      || Number(right.editorialScore || 0) - Number(left.editorialScore || 0)
      || Number(left.baselineRank || 9999) - Number(right.baselineRank || 9999)
  })[0]).filter(Boolean)
}

function facts(value, maxChars = 4200) {
  return completeSentences(String(value || ''), { maxChars, maxSentences: 12 })
}

export function normalizeExplicitToday(value, publishedAt) {
  const text = String(value || '')
  const year = new Date(publishedAt).getUTCFullYear()
  if (!Number.isInteger(year)) return text
  const match = text.match(/\btoday\s*\(\s*(?:(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}))\s*\)/i)
  if (!match) return text
  const day = match[1] || match[4]
  const month = match[2] || match[3]
  const parsed = new Date(`${month} ${day}, ${year} 00:00:00 UTC`)
  if (!Number.isFinite(parsed.getTime())) return text
  const exact = parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return text.replace(match[0], `on ${exact}`).replace(/\btoday\b/gi, found => `${found === 'Today' ? 'On' : 'on'} ${exact}`)
}

export function bindLeadingCoreferences(propositions) {
  const result = []
  for (const proposition of propositions || []) {
    const text = String(proposition || '').trim()
    if (/^(?:he|she|they|it|his|her|their|its)\b/i.test(text) && result.length) result[result.length - 1] = `${result[result.length - 1]} ${text}`
    else if (text) result.push(text)
  }
  return result
}

export function buildTrialItem(candidate, verificationIndex, contextIndex = new Map()) {
  const primaryFacts = facts(normalizeExplicitToday(candidate.evidence, candidate.publishedAt))
  const primaryUrl = canonicalUrl(candidate.primarySource.url)
  const displayedSources = [...candidate.sources, ...(candidate.supportingSources || [])]
    .filter((source, index, values) => values.findIndex(other => canonicalUrl(other.url) === canonicalUrl(source.url)) === index)
  const secondary = displayedSources.filter(source => canonicalUrl(source.url) !== primaryUrl).map((source, index) => {
    const verified = verificationIndex.get(canonicalUrl(source.url))
    if (!verified?.propositions?.length) return null
    return {
      sourceId: `support:${candidate.eventId}:${index + 1}`, publisher: source.publisher,
      url: source.url, publishedAt: verified.publishedAt || null, updatedAt: null,
      access: 'ok', wireOrigin: null, sourceType: 'verified supporting source',
      completeFactualPropositions: verified.propositions, limitations: [],
    }
  }).filter(Boolean)
  const context = (contextIndex.get(candidate.eventId) || []).map((source, index) => ({
    sourceId: `context:${candidate.eventId}:${index + 1}`, publisher: source.publisher,
    url: source.url, publishedAt: source.publishedAt || null, updatedAt: source.updatedAt || null,
    access: 'ok', wireOrigin: null, sourceType: source.sourceType || 'verified geographic context',
    completeFactualPropositions: source.propositions, limitations: source.limitations || [],
  }))
  const regions = candidate.priorityRegions || []
  const raw = {
    eventId: candidate.eventId,
    primaryNarrativeSource: {
      sourceId: `primary:${candidate.eventId}`, publisher: candidate.primarySource.publisher,
      url: candidate.primarySource.url, publishedAt: candidate.publishedAt, updatedAt: null,
      access: 'ok', wireOrigin: null, sourceType: 'publisher page',
      completeFactualPropositions: primaryFacts, limitations: [],
    },
    sourcePublicationTime: candidate.publishedAt,
    sourceUpdateTime: null,
    eventTimeOrWindow: [],
    coreFactualPropositions: primaryFacts,
    secondarySourceAdditions: [...secondary, ...context],
    provenance: [candidate.primarySource, ...secondary, ...context].map((source, index) => ({
      sourceId: source.sourceId || `primary:${candidate.eventId}:${index}`, publisher: source.publisher,
      url: source.url, wireOrigin: null, sourceType: source.sourceType || 'publisher page',
    })),
    attributionAndUncertainty: [
      'Publication time is not assumed to be event time.',
    ],
    geographicClassification: { eventLocations: regions.map(name => ({ name })), priorityRegions: regions },
    selectionRationale: `Selected from the ${LABELS[candidate.lane]} writer-ready lane for a controlled five-card trial.`,
    sourceAccessLimitations: [],
    curatorInstructions: [
      'Use only the complete source propositions above.',
      'Preserve attribution, negation, dates, numeric units and scope.',
      'Do not infer motives, causation, independent confirmation or missing sentence endings.',
      'Explain unfamiliar institutions, policies, places or scientific concepts only when the supplied propositions support the explanation.',
      ...(regions.includes('Syria') ? ['For Syrian first-level administrative divisions, always use the term Governorate; never write province.'] : []),
    ],
  }
  const selected = { eventId: candidate.eventId, title: candidate.headline, memberArticles: candidate.sources.map(source => ({ title: source.publisher })) }
  const scoped = buildBoundPacket(selected, raw, { temporal: { allowed_exact_dates: [] } })
  const bound = {
    ...scoped,
    coreFactualPropositions: bindLeadingCoreferences(scoped.coreFactualPropositions),
    primaryNarrativeSource: { ...scoped.primaryNarrativeSource, completeFactualPropositions: bindLeadingCoreferences(scoped.primaryNarrativeSource.completeFactualPropositions) },
    secondarySourceAdditions: scoped.secondarySourceAdditions.map(source => ({ ...source, completeFactualPropositions: bindLeadingCoreferences(source.completeFactualPropositions) })),
  }
  const timezone = regions.map(region => REGION_TIMEZONE[region]).find(Boolean) || 'UTC'
  const temporalPacket = buildWriterSafeTemporalPacket(bound, { sourceTimezone: timezone })
  return {
    eventId: candidate.eventId, lane: candidate.lane, sourceTitle: candidate.headline,
    sources: displayedSources, independentSourceCount: candidate.independentSourceCount,
    temporalPacket,
  }
}

export function partitionWriterExposure(items) {
  const ready = [], blocked = []
  for (const item of items) {
    const exposure = auditWriterTemporalExposure(item.temporalPacket)
    ;(exposure.passes ? ready : blocked).push({ item, exposure })
  }
  return { ready, blocked }
}

function preflightRejectedResult(item, exposure) {
  return {
    eventId: item.eventId, lane: item.lane, sourceTitle: item.sourceTitle, sources: item.sources,
    status: 'rejected', card: null,
    audits: {
      content: { valid: false, reasons: ['writer input failed temporal preflight'], wordCount: 0, pageCount: 0 },
      dates: { valid: false }, numbers: { valid: false, generatedNumbers: [], unsupportedNumbers: [] },
      relativeTime: { valid: false, generatedExpressions: [], allowedExpressions: [], unsupportedExpressions: exposure.unresolved_relative_expressions_exposed || [] },
      headline: { valid: false, sharedTerms: [] }, geography: { valid: false, forbidden: [] }, metadata: { valid: false, exposed: [] },
      writerExposure: exposure,
    },
    provider: { requestedModel: null, returnedModel: null, httpStatus: null, internalErrors: [], latencyMs: 0, finishReason: null, usage: null, safeHeaders: {}, complete: false, structuralStatus: 'writer_input_preflight_failure' },
  }
}

function supportedApproximateFraction(value, generated, evidence) {
  const normalized = Number(String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0])
  const mappings = new Map([
    [250000, /\b(?:almost|nearly|about|approximately)\s+(?:a|one)\s+quarter\s+of\s+(?:a|one)\s+million\b/i],
    [500000, /\b(?:almost|nearly|about|approximately)\s+(?:a|one)\s+half\s+of\s+(?:a|one)\s+million\b/i],
    [750000, /\b(?:almost|nearly|about|approximately)\s+three\s+quarters?\s+of\s+(?:a|one)\s+million\b/i],
  ])
  const phrase = mappings.get(normalized)
  if (!phrase?.test(evidence)) return false
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b(?:almost|nearly|about|approximately)\\s+(?:C\\$|\\$)?${escaped}\\b`, 'i').test(generated)
}

const NUMBER_WORDS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15],
  ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50],
  ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90],
])

function normalizeNumberWords(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b(?:a|one)\s+decade\b/g, '10 years')
    .replace(/\btwo\s+decades\b/g, '20 years')
    .replace(/\bthree\s+decades\b/g, '30 years')
    .replace(/\bfour\s+decades\b/g, '40 years')
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/g,
      (_match, tens, units) => String(NUMBER_WORDS.get(tens) + NUMBER_WORDS.get(units)))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
      match => String(NUMBER_WORDS.get(match)))
    .replace(/\b(\d+)\s+percent\b/g, '$1%')
    .replace(/(?<=\d),(?=\d{3}\b)/g, '')
}

export function numericAudit(card, packet) {
  const generated = [card?.headline, ...(card?.pages || []).map(page => page.text), ...(card?.uncertainties || [])].join(' ')
  const evidence = JSON.stringify(packet)
  const normalizedEvidence = normalizeNumberWords(evidence)
  const numbers = [...new Set((generated.match(/\b\d[\d,.]*(?:(?:%)(?!\w)|\s*(?:million|billion|trillion|people|years?|days?|hours?|km|kilometres?|met(?:re|er)s?|miles?|ft|feet|foot|tonnes?|dollars?)\b)?/gi) || [])
    .map(value => value.replace(/[,.]+$/, '')))]
  const supported = value => {
    const normalized = normalizeNumberWords(value)
    if (normalizedEvidence.includes(normalized)) return true
    const numericCore = normalized.match(/^\d+(?:\.\d+)?(?:%|\s+(?:million|billion|trillion))?/)?.[0]
    return Boolean(numericCore && new RegExp(`\\b${numericCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedEvidence))
  }
  const unsupported = numbers.filter(value => !supported(value)
    && !supportedApproximateFraction(value, generated, evidence))
  const qualifierMismatches = numbers.filter(value => {
    const core = normalizeNumberWords(value).match(/^\d+(?:\.\d+)?(?:%|\s+(?:million|billion|trillion))?/)?.[0]
    if (!core) return false
    const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const occurrenceKinds = text => [...text.matchAll(new RegExp(`\\b${escaped}\\b`, 'gi'))].map(match => {
      const prefix = text.slice(Math.max(0, match.index - 24), match.index)
      return /(?:more than|over|at least)\s*$/i.test(prefix) ? 'lower-bound' : 'unqualified'
    })
    const evidenceKinds = occurrenceKinds(normalizedEvidence)
    const generatedKinds = occurrenceKinds(normalizeNumberWords(generated))
    return evidenceKinds.length > 0
      && evidenceKinds.every(kind => kind === 'lower-bound')
      && generatedKinds.some(kind => kind === 'unqualified')
  })
  return { valid: unsupported.length === 0 && qualifierMismatches.length === 0, generatedNumbers: numbers, unsupportedNumbers: unsupported, qualifierMismatches }
}

export function relativeTimeAudit(card, packet) {
  const generated = [card?.headline, ...(card?.pages || []).map(page => page.text), ...(card?.uncertainties || [])].join(' ')
  const expressions = [...new Set([...generated.matchAll(/\b(?:tomorrow|tonight|next\s+(?:week|month|year)|last\s+(?:week|month|year)|this\s+(?:week|month|year))\b/gi)].map(match => match[0].toLowerCase()))]
  const allowed = new Set((packet?.temporal_facts_writer_may_state?.unresolved_relative_time || []).map(value => String(value.wording || '').toLowerCase()))
  const unsupported = expressions.filter(value => !allowed.has(value))
  return { valid: unsupported.length === 0, generatedExpressions: expressions, allowedExpressions: [...allowed], unsupportedExpressions: unsupported }
}

function headlineAudit(card, packet) {
  const terms = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length > 3))
  const headline = terms(card?.headline), evidence = terms(JSON.stringify(packet))
  const shared = [...headline].filter(term => evidence.has(term))
  return { valid: shared.length >= Math.min(3, headline.size), sharedTerms: shared }
}

export function geographyAudit(card, item) {
  const generated = [card?.headline, ...(card?.pages || []).map(page => page.text), ...(card?.uncertainties || [])].join(' ')
  const priorityRegions = item?.temporalPacket?.writer_facing?.geographicClassification?.priorityRegions || []
  const forbidden = []
  if (priorityRegions.includes('Syria') && /\bprovince\b/i.test(generated)) forbidden.push('province used for a Syrian first-level administrative division')
  return { valid: forbidden.length === 0, forbidden }
}

export function writerMetadataAudit(card) {
  const generated = [card?.headline, ...(card?.pages || []).map(page => page.text), ...(card?.uncertainties || [])].join(' ')
  const patterns = [
    /\bselection gate\b/i,
    /\bsource-led packet\b/i,
    /\bindependent source families?\b/i,
    /\bcurator instructions?\b/i,
    /\bwriter(?:-facing)? (?:input|packet|instructions?)\b/i,
  ]
  const exposed = patterns.filter(pattern => pattern.test(generated)).map(pattern => pattern.source)
  return { valid: exposed.length === 0, exposed }
}

function auditCard(item, card) {
  const content = validateCardContent(card)
  const dates = validateGeneratedDates(card, { allowed_exact_dates: item.temporalPacket.allowed_exact_dates.map(date => ({ date })) })
  const numbers = numericAudit(card, item.temporalPacket.writer_facing)
  const relativeTime = relativeTimeAudit(card, item.temporalPacket.writer_facing)
  const headline = headlineAudit(card, item.temporalPacket.writer_facing)
  const geography = geographyAudit(card, item)
  const metadata = writerMetadataAudit(card)
  const audits = { content, dates, numbers, relativeTime, headline, geography, metadata, writerExposure: auditWriterTemporalExposure(item.temporalPacket) }
  return { audits, valid: content.valid && dates.valid && numbers.valid && relativeTime.valid && headline.valid && geography.valid && metadata.valid && audits.writerExposure.passes }
}

function reportFor(items, results, options, complete) {
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceShortlist: options.shortlist,
    sourceVerification: options.verification, writerConfiguration: WRITER_CONFIGURATION,
    complete, expected: items.length, resultCount: results.length,
    accepted: results.filter(result => result.status === 'accepted').length,
    rejected: results.filter(result => result.status === 'rejected').length,
    totalNeurons: results.reduce((sum, result) => sum + Number(result.provider.usage?.neurons || 0), 0),
    inputTokens: results.reduce((sum, result) => sum + Number(result.provider.usage?.prompt_tokens || result.provider.usage?.input_tokens || 0), 0),
    outputTokens: results.reduce((sum, result) => sum + Number(result.provider.usage?.completion_tokens || result.provider.usage?.output_tokens || 0), 0),
    totalLatencyMs: results.reduce((sum, result) => sum + Number(result.provider.latencyMs || 0), 0),
    results,
  }
}

function markdown(report) {
  const lines = ['# Writer-ready focused trial', '', `Generated: ${report.createdAt}`, '', `Model: ${report.writerConfiguration.model}; thinking disabled; no automatic retries.`, '']
  for (const [index, result] of report.results.entries()) {
    lines.push(`## ${index + 1}. ${LABELS[result.lane]}`, '', `Source event: ${result.sourceTitle}`, '', `Status: ${result.status}`, '')
    if (result.card) {
      lines.push(`### ${result.card.headline}`, '')
      for (const page of result.card.pages) lines.push(page.text, '')
      if (result.card.uncertainties?.length) lines.push(`Uncertainties: ${result.card.uncertainties.join(' · ')}`, '')
    }
    lines.push(`Sources: ${result.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
    lines.push(`Checks: structure=${result.audits.content.valid}; dates=${result.audits.dates.valid}; relative-time=${result.audits.relativeTime.valid}; numbers=${result.audits.numbers.valid}; headline=${result.audits.headline.valid}; geography=${result.audits.geography?.valid ?? true}; metadata=${result.audits.metadata?.valid ?? true}`, '')
  }
  return `${lines.join('\n')}\n`
}

async function save(outputDir, items, results, options, complete) {
  const report = reportFor(items, results, options, complete)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'TRIAL_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'TRIAL_REVIEW.md'), markdown(report), 'utf8'),
    fs.writeFile(path.join(outputDir, 'TRIAL_INPUT.json'), `${JSON.stringify({ schemaVersion: 1, createdAt: report.createdAt, items }, null, 2)}\n`, 'utf8'),
  ])
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const shortlist = JSON.parse(await fs.readFile(options.shortlist, 'utf8'))
  const verificationReports = await Promise.all(options.verification.map(async file => JSON.parse(await fs.readFile(file, 'utf8'))))
  const contextFiles = await Promise.all(options.context.map(async file => JSON.parse(await fs.readFile(file, 'utf8'))))
  const verificationIndex = buildVerificationIndex(verificationReports)
  const contextIndex = buildContextIndex(contextFiles)
  const chosen = options.eventIds.length
    ? options.eventIds.map(eventId => shortlist.selected.find(candidate => candidate.eventId === eventId)).filter(Boolean)
    : options.allSelected ? shortlist.selected : chooseTrialCandidates(shortlist)
  if (options.eventIds.length && chosen.length !== options.eventIds.length) throw new Error(`Could not find every requested event ID; requested ${options.eventIds.length}, found ${chosen.length}`)
  const items = chosen.map(candidate => buildTrialItem(candidate, verificationIndex, contextIndex))
  if (!options.eventIds.length && !options.allSelected && items.length !== LANES.length) throw new Error(`Expected one candidate in each of ${LANES.length} lanes; found ${items.length}`)
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ selected: items.map(item => ({ eventId: item.eventId, lane: item.lane, title: item.sourceTitle, displayedSources: item.sources.length, evidenceBackedSecondarySources: item.temporalPacket.writer_facing.secondarySourceAdditions.length, writerExposure: auditWriterTemporalExposure(item.temporalPacket) })) }, null, 2)}\n`)
    return
  }
  const exposurePartition = partitionWriterExposure(items)
  let results = []
  try { results = JSON.parse(await fs.readFile(path.join(options.outputDir, 'TRIAL_REPORT.json'), 'utf8')).results || [] } catch {}
  if (options.retryRejected) results = results.filter(result => result.status !== 'rejected')
  const itemById = new Map(items.map(value => [value.eventId, value]))
  results = results.map(result => {
    const item = itemById.get(result.eventId)
    if (!item || !result.card) return result
    const { audits, valid } = auditCard(item, result.card)
    return { ...result, status: result.provider.complete && valid ? 'accepted' : 'rejected', audits }
  })
  const existingIds = new Set(results.map(result => result.eventId))
  for (const { item, exposure } of exposurePartition.blocked) if (!existingIds.has(item.eventId)) results.push(preflightRejectedResult(item, exposure))
  const completed = new Set(results.map(value => value.eventId))
  for (const item of exposurePartition.ready.map(value => value.item).filter(value => !completed.has(value.eventId))) {
    const attempt = await writeCard(item.temporalPacket.writer_facing, { dateRetry: options.retryRejected, repair: options.retryRejected })
    const card = attempt.complete ? attempt.parsed : null
    const audited = card ? auditCard(item, card) : { valid: false, audits: { content: { valid: false, reasons: ['writer output incomplete'], wordCount: 0, pageCount: 0 }, dates: { valid: false }, numbers: { valid: false, generatedNumbers: [], unsupportedNumbers: [] }, relativeTime: { valid: false, generatedExpressions: [], allowedExpressions: [], unsupportedExpressions: [] }, headline: { valid: false, sharedTerms: [] }, writerExposure: auditWriterTemporalExposure(item.temporalPacket) } }
    const valid = attempt.complete && audited.valid
    results.push({
      eventId: item.eventId, lane: item.lane, sourceTitle: item.sourceTitle, sources: item.sources,
      status: valid ? 'accepted' : 'rejected', card,
      audits: audited.audits,
      provider: { requestedModel: attempt.requestedModel, returnedModel: attempt.returnedModel, httpStatus: attempt.httpStatus, internalErrors: attempt.internalErrors, latencyMs: attempt.latencyMs, finishReason: attempt.finishReason, usage: attempt.usage, safeHeaders: attempt.safeHeaders, complete: attempt.complete, structuralStatus: attempt.structuralStatus },
    })
    await save(options.outputDir, items, results, options, false)
  }
  const report = await save(options.outputDir, items, results, options, results.length === items.length)
  process.stdout.write(`${JSON.stringify({ complete: report.complete, resultCount: report.resultCount, accepted: report.accepted, rejected: report.rejected, totalNeurons: report.totalNeurons, inputTokens: report.inputTokens, outputTokens: report.outputTokens, totalLatencyMs: report.totalLatencyMs }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
