import fs from 'node:fs/promises'
import path from 'node:path'
import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { buildBoundPacket } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/scope.mjs'
import { validateGeneratedDates } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/temporal.mjs'
import { auditWriterTemporalExposure, buildWriterSafeTemporalPacket } from '../../artifacts/summary-feasibility/writer-safe-temporal-input-fix/writer-safe-temporal.mjs'
import { validateCardContent } from '../../scripts/news-beta/content-validation.mjs'
import { writeCard, WRITER_CONFIGURATION } from '../../scripts/news-beta/writer.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'

const LANES = ['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']
const LABELS = { 'world-major': 'Major world', 'priority-major': 'Major priority region', 'world-interesting': 'Interesting world', 'priority-interesting': 'Interesting priority region', discovery: 'Discovery' }
const REGION_TIMEZONE = { Syria: 'Asia/Damascus', 'Middle East': 'Asia/Qatar', Bangladesh: 'Asia/Dhaka', Ghana: 'Africa/Accra', Canada: 'America/Toronto', GTA: 'America/Toronto' }

function parseArgs(argv) {
  const options = { edition: null, packets: null, prepareFixture: null, outputDir: null, count: 10, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--edition') options.edition = argv[++index]
    else if (argv[index] === '--packets') options.packets = argv[++index]
    else if (argv[index] === '--prepare-fixture') options.prepareFixture = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--count') options.count = Number(argv[++index])
    else if (argv[index] === '--dry-run') options.dryRun = true
  }
  if ((!options.edition && !options.packets) || (!options.outputDir && !options.prepareFixture)) throw new Error('Provide --edition or --packets, plus --output-dir or --prepare-fixture')
  if (options.edition && options.packets) throw new Error('Use only one of --edition or --packets')
  if (!Number.isInteger(options.count) || options.count < 5 || options.count > 15) throw new Error('--count must be from 5 to 15')
  return options
}

function toFixtureItem(item) {
  return {
    eventId: item.event.id,
    lane: item.event.representative.selection.assignedLane,
    sourceTitle: item.event.representative.snapshot.title,
    sources: item.event.members.map(member => ({ publisher: member.snapshot.publisher, url: member.snapshot.finalUrl || member.snapshot.sourceUrl })),
    corroborationStatus: item.event.corroborationStatus,
    temporalPacket: item.packet.temporal,
  }
}

function choosePrepared(events, count) {
  const chosen = []
  for (const lane of LANES) {
    const candidates = events.filter(event => event.representative.selection.assignedLane === lane)
      .map(event => ({ event, packet: buildPacket(event) }))
      .filter(item => auditWriterTemporalExposure(item.packet.temporal).passes
        && item.packet.temporal.writer_facing.coreFactualPropositions.length >= 2
        && assessExtractedEvidence(item.event.representative.snapshot.evidenceText).adequate)
    if (!candidates.length) continue
    chosen.push(candidates[0])
    const firstRegions = new Set(candidates[0].event.representative.selection.representative.priorityRegions || [])
    const second = candidates.slice(1).find(item => item.event.independentSourceCount >= 2)
      || candidates.slice(1).find(item => (item.event.representative.selection.representative.priorityRegions || []).some(region => !firstRegions.has(region)))
      || candidates[1]
    if (second) chosen.push(second)
  }
  return chosen.slice(0, count)
}

function facts(snapshot) {
  return completeSentences(snapshot.evidenceText, { maxChars: 4800, maxSentences: 12 })
}

function buildPacket(event) {
  const primary = event.representative
  const primaryFacts = facts(primary.snapshot)
  const secondary = event.members.filter(member => member !== primary).map(member => ({
    sourceId: member.selection.id, publisher: member.snapshot.publisher,
    url: member.snapshot.finalUrl || member.snapshot.sourceUrl,
    publishedAt: member.snapshot.publishedAt, updatedAt: null,
    access: member.snapshot.status, wireOrigin: null, sourceType: 'publisher page',
    completeFactualPropositions: facts(member.snapshot),
    limitations: [],
  })).filter(source => source.completeFactualPropositions.length >= 2)
  const regions = primary.selection.representative.priorityRegions || []
  const packet = {
    eventId: event.id,
    primaryNarrativeSource: {
      sourceId: primary.selection.id, publisher: primary.snapshot.publisher,
      url: primary.snapshot.finalUrl || primary.snapshot.sourceUrl,
      publishedAt: primary.snapshot.publishedAt, updatedAt: null,
      access: primary.snapshot.status, wireOrigin: null, sourceType: 'publisher page',
      completeFactualPropositions: primaryFacts,
      limitations: [],
    },
    sourcePublicationTime: primary.snapshot.publishedAt,
    sourceUpdateTime: null,
    eventTimeOrWindow: [],
    coreFactualPropositions: primaryFacts,
    secondarySourceAdditions: secondary,
    provenance: event.members.map(member => ({
      sourceId: member.selection.id, publisher: member.snapshot.publisher,
      url: member.snapshot.finalUrl || member.snapshot.sourceUrl,
      wireOrigin: null, sourceType: 'publisher page',
    })),
    attributionAndUncertainty: [
      event.corroborationStatus === 'multi-source' ? `${event.independentSourceCount} independent source families are represented.` : 'This event currently has one source family; preserve explicit attribution for contested or high-risk claims.',
      'Publication time is not assumed to be event time.',
    ],
    geographicClassification: { eventLocations: regions.map(name => ({ name })), priorityRegions: regions },
    selectionRationale: `Selected from the ${LABELS[primary.selection.assignedLane]} lane for the controlled generation trial.`,
    sourceAccessLimitations: [],
    curatorInstructions: ['Use only the complete source propositions above.', 'Preserve attribution, negation, dates, numeric units and scope.', 'Do not infer motives, causation, independent confirmation or missing sentence endings.'],
  }
  const selected = { eventId: event.id, title: primary.snapshot.title, memberArticles: event.members.map(member => ({ title: member.snapshot.title })) }
  const bound = buildBoundPacket(selected, packet, { temporal: { allowed_exact_dates: [] } })
  const timezone = regions.map(region => REGION_TIMEZONE[region]).find(Boolean) || 'UTC'
  return { raw: packet, bound, temporal: buildWriterSafeTemporalPacket(bound, { sourceTimezone: timezone }) }
}

function numericAudit(card, packet) {
  const generated = [card?.headline, ...(card?.pages || []).map(page => page.text), ...(card?.uncertainties || [])].join(' ')
  const evidence = JSON.stringify(packet)
  const numbers = [...new Set(generated.match(/\b\d[\d,.]*(?:%|\s*(?:million|billion|trillion|people|years?|days?|hours?|km|kilometres?|miles?|tonnes?|dollars?))?\b/gi) || [])]
  const unsupported = numbers.filter(value => !evidence.toLowerCase().includes(value.toLowerCase()))
  return { valid: unsupported.length === 0, generatedNumbers: numbers, unsupportedNumbers: unsupported }
}

function headlineAudit(card, packet) {
  const terms = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length > 3))
  const headline = terms(card?.headline)
  const evidence = terms(JSON.stringify(packet))
  const shared = [...headline].filter(term => evidence.has(term))
  return { valid: shared.length >= Math.min(3, headline.size), sharedTerms: shared }
}

function reviewMarkdown(report) {
  const lines = ['# Five-lane generated-card trial', '', `Generated: ${report.createdAt}`, '', `Model: ${report.writerConfiguration.model}; thinking disabled.`, '']
  report.results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${LABELS[result.lane]}`, '', `Source event: ${result.sourceTitle}`, '', `Status: ${result.status}`, '')
    if (result.card) {
      lines.push(`### ${result.card.headline}`, '')
      result.card.pages.forEach(page => lines.push(page.text, ''))
      if (result.card.uncertainties?.length) lines.push(`Uncertainties: ${result.card.uncertainties.join(' · ')}`, '')
    }
    lines.push(`Sources: ${result.sources.map(source => `[${source.publisher}](${source.url})`).join(', ')}`, '')
    lines.push(`Checks: structure=${result.audits.content.valid}; dates=${result.audits.dates.valid}; numbers=${result.audits.numbers.valid}; headline=${result.audits.headline.valid}`, '')
  })
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  let prepared
  if (options.packets) {
    const fixture = JSON.parse(await fs.readFile(options.packets, 'utf8'))
    prepared = fixture.items.slice(0, options.count)
  } else {
    const edition = JSON.parse(await fs.readFile(options.edition, 'utf8'))
    prepared = choosePrepared(edition.events, options.count).map(toFixtureItem)
  }
  if (options.prepareFixture) {
    const fixture = { schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: options.edition, items: prepared }
    await fs.mkdir(path.dirname(options.prepareFixture), { recursive: true })
    await fs.writeFile(options.prepareFixture, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({ prepared: fixture.items.length, output: options.prepareFixture }, null, 2)}\n`)
    return
  }
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ selected: prepared.map(item => ({ lane: item.lane, title: item.sourceTitle, sources: item.sources.length, writerExposure: auditWriterTemporalExposure(item.temporalPacket) })) }, null, 2)}\n`)
    return
  }
  const results = []
  for (const item of prepared) {
    const attempt = await writeCard(item.temporalPacket.writer_facing)
    const card = attempt.complete ? attempt.parsed : null
    const content = card ? validateCardContent(card) : { valid: false, reasons: ['writer output incomplete'], wordCount: 0, pageCount: 0 }
    const dates = card ? validateGeneratedDates(card, { allowed_exact_dates: item.temporalPacket.allowed_exact_dates.map(date => ({ date })) }) : { valid: false }
    const numbers = card ? numericAudit(card, item.temporalPacket.writer_facing) : { valid: false, generatedNumbers: [], unsupportedNumbers: [] }
    const headline = card ? headlineAudit(card, item.temporalPacket.writer_facing) : { valid: false, sharedTerms: [] }
    const valid = attempt.complete && content.valid && dates.valid && numbers.valid && headline.valid
    results.push({
      eventId: item.eventId, lane: item.lane,
      sourceTitle: item.sourceTitle,
      sources: item.sources,
      corroborationStatus: item.corroborationStatus,
      status: valid ? 'accepted' : 'rejected', card,
      audits: { content, dates, numbers, headline, writerExposure: auditWriterTemporalExposure(item.temporalPacket) },
      provider: { requestedModel: attempt.requestedModel, returnedModel: attempt.returnedModel, httpStatus: attempt.httpStatus, internalErrors: attempt.internalErrors, latencyMs: attempt.latencyMs, finishReason: attempt.finishReason, usage: attempt.usage, safeHeaders: attempt.safeHeaders, complete: attempt.complete, structuralStatus: attempt.structuralStatus },
    })
  }
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: options.edition || options.packets,
    writerConfiguration: WRITER_CONFIGURATION,
    resultCount: results.length, accepted: results.filter(result => result.status === 'accepted').length,
    rejected: results.filter(result => result.status === 'rejected').length,
    totalNeurons: results.reduce((sum, result) => sum + Number(result.provider.usage?.neurons || 0), 0),
    inputTokens: results.reduce((sum, result) => sum + Number(result.provider.usage?.prompt_tokens || result.provider.usage?.input_tokens || 0), 0),
    outputTokens: results.reduce((sum, result) => sum + Number(result.provider.usage?.completion_tokens || result.provider.usage?.output_tokens || 0), 0),
    totalLatencyMs: results.reduce((sum, result) => sum + Number(result.provider.latencyMs || 0), 0),
    results,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'TRIAL_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'TRIAL_REVIEW.md'), reviewMarkdown(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ resultCount: report.resultCount, accepted: report.accepted, rejected: report.rejected, totalNeurons: report.totalNeurons, inputTokens: report.inputTokens, outputTokens: report.outputTokens, totalLatencyMs: report.totalLatencyMs }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
