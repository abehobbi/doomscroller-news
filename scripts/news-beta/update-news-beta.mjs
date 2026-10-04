import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ACTIVE_FEED_MAXIMUM, ACTIVE_FEED_MINIMUM, buildEvidenceBatch, classifyCardRegions,
  consolidatePublishedCards, evidenceFingerprint, isEditoriallyEligibleTitle, selectActiveFeedCards,
} from './pipeline.mjs'
import { writeCard, WRITER_CONFIGURATION } from './writer.mjs'
import { buildBoundPacket, detectCrossPacketOverlap } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/scope.mjs'
import { validateGeneratedDates } from '../../artifacts/summary-feasibility/date-scope-reliability-fix/temporal.mjs'
import { buildWriterSafeTemporalPacket, auditWriterTemporalExposure } from '../../artifacts/summary-feasibility/writer-safe-temporal-input-fix/writer-safe-temporal.mjs'
import { validateCardContent } from './content-validation.mjs'

const root = process.cwd()
const datasetPath = path.resolve(root, process.env.NEWS_BETA_DATASET_PATH || 'public/news/beta-feed.json')
const controlPath = path.resolve(root, process.env.NEWS_BETA_CONTROL_PATH || 'public/news/beta-control.json')
const diagnosticsDir = path.resolve(root, process.env.NEWS_BETA_DIAGNOSTICS_DIR || 'artifacts/news-beta')
const TIMEZONES = new Map([
  ['MyJoyOnline', 'Africa/Accra'], ['Graphic Online', 'Africa/Accra'], ['GhanaWeb', 'Africa/Accra'],
  ['Dhaka Tribune', 'Asia/Dhaka'], ['BD24Live English', 'Asia/Dhaka'], ['Prothom Alo English', 'Asia/Dhaka'],
  ['Al Jazeera', 'Asia/Qatar'], ['The Guardian World', 'Europe/London'], ['BBC World', 'Europe/London'],
  ['BBC Technology', 'Europe/London'], ['CBC Canada', 'America/Toronto'], ['CBC Toronto', 'America/Toronto'],
  ['DW World', 'Europe/Berlin'], ['Africanews', 'Europe/Paris'], ['Euronews', 'Europe/Paris'], ['Global Voices', 'UTC'],
  ['City of Toronto News', 'America/Toronto'], ['SANA English', 'Asia/Damascus'], ['North Press Agency', 'Asia/Damascus'],
  ['Enab Baladi English', 'Asia/Damascus'], ['Syria Direct', 'Asia/Damascus'],
  ['Ghana News Agency', 'Africa/Accra'], ['Arab News', 'Asia/Riyadh'], ['The Japan Times', 'Asia/Tokyo'],
  ['The Indian Express Bangladesh', 'Asia/Kolkata'], ['The Indian Express World', 'Asia/Kolkata'],
  ['The Indian Express Science', 'Asia/Kolkata'], ['The Indian Express Research', 'Asia/Kolkata'],
])

const words = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length > 3))
const intersection = (left, right) => [...left].filter(value => right.has(value))
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null } }
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const exists = file => fs.stat(file).then(() => true, () => false)

function matchPrevious(item, previousCards) {
  const urls = new Set(item.packet.provenance.map(source => source.url))
  const geography = new Set(item.event.regions)
  const titleWords = words(item.event.primary.title)
  let best = null
  for (const card of previousCards) {
    const priorUrls = new Set((card.sources || []).map(source => source.url))
    if (intersection(urls, priorUrls).length) return { card, reason: 'same source URL' }
    const priorWords = words(card.headline), shared = intersection(titleWords, priorWords).length
    const denominator = Math.max(titleWords.size, priorWords.size, 1)
    const sameRegion = !geography.size || intersection(geography, new Set(card.geography || [])).length > 0
    const score = shared / denominator
    if (sameRegion && score >= 0.72 && (!best || score > best.score)) best = { card, reason: `conservative headline/geography match (${score.toFixed(2)})`, score }
  }
  return best
}

function stripAttempt(attempt) {
  return {
    timestamp: attempt.timestamp, finishedAt: attempt.finishedAt, requestedModel: attempt.requestedModel,
    returnedModel: attempt.returnedModel, httpStatus: attempt.httpStatus, internalErrors: attempt.internalErrors,
    rawStructuredText: attempt.rawStructuredText, parsed: attempt.parsed, parseError: attempt.parseError,
    providerParseError: attempt.providerParseError, schemaAudit: attempt.schemaAudit, finishReason: attempt.finishReason,
    usage: attempt.usage, latencyMs: attempt.latencyMs, safeHeaders: attempt.safeHeaders,
    complete: attempt.complete, structuralStatus: attempt.structuralStatus, dateRetry: attempt.dateRetry,
  }
}

function sourceList(packet) {
  return packet.provenance.map((source, index) => {
    const detail = index === 0 ? packet.primaryNarrativeSource : packet.secondarySourceAdditions.find(item => item.sourceId === source.sourceId)
    return { name: source.publisher, url: source.url, role: index === 0 ? 'primary' : 'additional', publishedAt: detail?.publishedAt || null, updatedAt: detail?.updatedAt || null }
  })
}

function makeCard({ eventId, item, generated, fingerprint, now, previous }) {
  const imageUrl = safeUrl(item.image.url)
  return {
    event_id: eventId, headline: generated.headline, pages: generated.pages,
    uncertainties: Array.isArray(generated.uncertainties) ? generated.uncertainties : [],
    image: {
      url: imageUrl, alt: imageUrl ? item.image.alt : null,
      status: imageUrl ? 'event-specific' : 'fallback', source_url: item.image.sourceUrl,
      attribution: item.image.attribution, rights_basis: imageUrl ? 'Publisher-hosted remote reference; no image bytes are copied and no reuse rights are asserted.' : 'No publisher image selected.',
    },
    sources: sourceList(item.packet), geography: item.event.regions, topics: item.event.primary.topics || [],
    first_seen: previous?.first_seen || previous?.firstSeen || now,
    updated_at: now, generated_at: now, evidence_fingerprint: fingerprint,
    content_version: Math.max(1, Number(previous?.content_version || previous?.contentVersion || 0) + 1),
    selection_score: item.event.score,
    editorial_facets: {
      consequence: Number(item.event.scoreParts?.consequence || 0),
      discovery: Number(item.event.scoreParts?.discovery || item.event.scoreParts?.interestingness || 0),
      local_texture: Number(item.event.scoreParts?.localTexture || 0),
    },
  }
}

async function main() {
  const startedAt = new Date().toISOString(), started = performance.now()
  const previousDataset = await exists(datasetPath) ? await readJson(datasetPath) : null
  const allPreviousCards = Array.isArray(previousDataset?.cards) ? previousDataset.cards : []
  const previousCardAudits = allPreviousCards.map(card => ({ card, audit: validateCardContent(card) }))
  const previousCards = previousCardAudits.filter(value => value.audit.valid).map(value => value.card)
  const batch = await buildEvidenceBatch()
  const candidates = []
  const rejected = [...batch.evidenceRejected.map(value => ({ stage: 'evidence', ...value }))]

  for (const item of batch.selected) {
    const previousMatch = matchPrevious(item, previousCards)
    const eventId = previousMatch?.card?.event_id || item.event.id
    const fingerprint = evidenceFingerprint(item.packet)
    if (previousMatch?.card?.evidence_fingerprint === fingerprint) {
      rejected.push({ eventId, title: item.event.primary.title, stage: 'unchanged', reason: 'evidence fingerprint unchanged from published card' })
      continue
    }
    const selected = { eventId, title: item.event.primary.title, memberArticles: item.event.articles }
    const scoped = buildBoundPacket(selected, { ...item.packet, eventId }, { temporal: { allowed_exact_dates: [] } })
    const sourceTimezone = TIMEZONES.get(scoped.primaryNarrativeSource?.publisher) || null
    const temporal = buildWriterSafeTemporalPacket(scoped, { sourceTimezone })
    const exposure = auditWriterTemporalExposure(temporal)
    if (!exposure.passes) {
      rejected.push({ eventId, title: item.event.primary.title, stage: 'writer-safety', reason: 'unsafe temporal metadata exposure' })
      continue
    }
    candidates.push({ eventId, item, fingerprint, previous: previousMatch?.card || null, previousMatch: previousMatch?.reason || null, scoped, temporal, writerPacket: temporal.writer_facing })
  }

  const overlapPackets = candidates.map(candidate => ({ ...candidate.writerPacket, eventId: candidate.eventId, evidence_fragments: candidate.scoped.evidence_fragments }))
  const overlaps = detectCrossPacketOverlap(overlapPackets, { includedOnly: true })
  const conflicted = new Set(overlaps.flatMap(value => [value.packet_event_id, value.other_event_id]))
  if (process.env.NEWS_BETA_PREFLIGHT_ONLY === 'yes') {
    console.log(JSON.stringify({
      discovery: batch.counts, sourceStatus: batch.sourceStatus,
      selected: batch.selected.map(value => ({
        eventId: value.event.id, title: value.event.primary.title, publisher: value.packet.primaryNarrativeSource.publisher,
        score: value.event.score, scoreParts: value.event.scoreParts, regions: value.event.regions,
      })),
      reranker: batch.reranker, candidateCount: candidates.length, rejected, overlaps, conflicted: [...conflicted],
    }, null, 2))
    return
  }
  const accepted = [], generation = []
  // Two daily checks share the free inference allowance. Once the rolling feed
  // exists, each check may add/update at most ten cards rather than replacing it.
  const generationLimit = previousCards.length >= ACTIVE_FEED_MINIMUM ? 10 : ACTIVE_FEED_MINIMUM
  for (const candidate of candidates) {
    if (accepted.length >= generationLimit) break
    if (conflicted.has(candidate.eventId)) {
      rejected.push({ eventId: candidate.eventId, title: candidate.item.event.primary.title, stage: 'event-scope', reason: 'included evidence overlaps another selected central event' })
      continue
    }
    const attempts = []
    let attempt = await writeCard(candidate.writerPacket)
    attempts.push(stripAttempt(attempt))
    if (!attempt.complete) {
      rejected.push({ eventId: candidate.eventId, title: candidate.item.event.primary.title, stage: attempt.structuralStatus, reason: 'writer output did not pass structural validation' })
      generation.push({ eventId: candidate.eventId, finalStatus: attempt.structuralStatus, attempts })
      continue
    }
    let contentValidation = validateCardContent(attempt.parsed)
    if (!contentValidation.valid) {
      rejected.push({ eventId: candidate.eventId, title: candidate.item.event.primary.title, stage: 'content-structure', reason: contentValidation.reasons.join('; ') })
      generation.push({ eventId: candidate.eventId, finalStatus: 'content_structure_failure', contentValidation, attempts })
      continue
    }
    let dateValidation = validateGeneratedDates(attempt.parsed, { allowed_exact_dates: candidate.temporal.allowed_exact_dates.map(date => ({ date })) })
    if (!dateValidation.valid && dateValidation.status === 'date_validation_failure') {
      attempt = await writeCard(candidate.writerPacket, { dateRetry: true })
      attempts.push(stripAttempt(attempt))
      contentValidation = attempt.complete ? validateCardContent(attempt.parsed) : null
      dateValidation = attempt.complete && contentValidation?.valid ? validateGeneratedDates(attempt.parsed, { allowed_exact_dates: candidate.temporal.allowed_exact_dates.map(date => ({ date })) }) : null
    }
    if (!attempt.complete || !dateValidation?.valid) {
      const status = !attempt.complete ? attempt.structuralStatus : 'date_validation_failure'
      rejected.push({ eventId: candidate.eventId, title: candidate.item.event.primary.title, stage: status, reason: attempts.length > 1 ? 'bounded date retry failed' : 'date validation failed' })
      generation.push({ eventId: candidate.eventId, finalStatus: status, dateValidation, attempts })
      continue
    }
    const now = new Date().toISOString()
    const card = makeCard({ eventId: candidate.eventId, item: candidate.item, generated: attempt.parsed, fingerprint: candidate.fingerprint, now, previous: candidate.previous })
    accepted.push(card)
    generation.push({
      eventId: candidate.eventId, title: candidate.item.event.primary.title, finalStatus: 'accepted',
      previousMatch: candidate.previousMatch, contentVersion: card.content_version,
      evidenceFingerprint: candidate.fingerprint, allowedExactDates: candidate.temporal.allowed_exact_dates,
      dateValidation, writerExposureAudit: auditWriterTemporalExposure(candidate.temporal),
      contentValidation,
      scope: { fragments: candidate.scoped.evidence_fragments.map(fragment => ({ fragmentId: fragment.fragment_id, sourceId: fragment.source_id, membership: fragment.event_membership, reason: fragment.reason })) },
      provenance: candidate.item.packet.provenance, image: card.image, attempts,
    })
  }

  const acceptedIds = new Set(accepted.map(card => card.event_id))
  const retained = previousCards.filter(card => !acceptedIds.has(card.event_id)).filter(card => Date.now() - Date.parse(card.updated_at) < 45 * 86_400_000)
    .filter(card => isEditoriallyEligibleTitle(card.headline))
    .map(card => ({ ...card, geography: classifyCardRegions(card) }))
  const cards = consolidatePublishedCards([...accepted, ...retained])
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 120)
  const activeCards = selectActiveFeedCards(cards)
  if (!cards.length) throw new Error('No accepted or previously published beta cards; refusing to publish an empty dataset')
  const generatedAt = new Date().toISOString(), batchId = `news-beta-${generatedAt.replace(/[:.]/g, '-')}`
  const dataset = {
    schema: 'doomscroller.news-beta-dataset', schemaVersion: 1, generatedAt, batchId,
    feed: { eventIds: activeCards.map(card => card.event_id) }, cards,
    policy: {
      activeFeedMinimum: ACTIVE_FEED_MINIMUM, activeFeedMaximum: ACTIVE_FEED_MAXIMUM,
      activeFeedSize: activeCards.length, candidateReserveSize: 90,
      checksPerDay: 2, maximumNewOrUpdatedPerRun: generationLimit,
      targetNewOrUpdatedPerDay: 12, maximumNewOrUpdatedPerDay: 20,
      retentionDays: 45, model: WRITER_CONFIGURATION.model, thinking: false, temperature: 0.2,
    },
  }
  const attempts = generation.flatMap(item => item.attempts)
  const diagnostics = {
    schema: 'doomscroller.news-beta-diagnostics', schemaVersion: 1, batchId, startedAt, finishedAt: generatedAt,
    durationMs: Math.round(performance.now() - started), writerConfiguration: WRITER_CONFIGURATION,
    discovery: batch.counts, sourceStatus: batch.sourceStatus, knownSourceFailures: batch.knownSourceFailures,
    reranker: batch.reranker, selectedEvents: batch.selected.map(item => ({ eventId: item.event.id, title: item.event.primary.title, score: item.event.score, scoreParts: item.event.scoreParts, regions: item.event.regions })),
    invalidPreviousCardsRemoved: previousCardAudits.filter(value => !value.audit.valid).map(value => ({ eventId: value.card.event_id, headline: value.card.headline, audit: value.audit })),
    crossEventOverlap: overlaps, generation, rejections: rejected,
    outcome: {
      writerRequests: attempts.length, retries: attempts.filter(attempt => attempt.dateRetry).length,
      acceptedCards: accepted.length, retainedCards: retained.length, skippedCards: rejected.length,
      totalNeurons: attempts.reduce((total, attempt) => total + Number(attempt.usage?.neurons || 0), 0),
      inputTokens: attempts.reduce((total, attempt) => total + Number(attempt.usage?.prompt_tokens || attempt.usage?.input_tokens || 0), 0),
      outputTokens: attempts.reduce((total, attempt) => total + Number(attempt.usage?.completion_tokens || attempt.usage?.output_tokens || 0), 0),
      meanNeuronsPerAcceptedCard: accepted.length ? Number((attempts.reduce((total, attempt) => total + Number(attempt.usage?.neurons || 0), 0) / accepted.length).toFixed(2)) : null,
      datasetBytes: Buffer.byteLength(JSON.stringify(dataset)), thirdPartyCostUsd: 0,
      imageStatus: cards.reduce((counts, card) => ({ ...counts, [card.image.status]: (counts[card.image.status] || 0) + 1 }), {}),
      geographicDistribution: cards.reduce((counts, card) => { for (const region of card.geography || ['World']) counts[region] = (counts[region] || 0) + 1; return counts }, {}),
    },
    integrity: { datasetSha256: crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex') },
  }
  const control = { schema: 'doomscroller.news-beta-control', schemaVersion: 1, enabled: true, datasetUrl: 'beta-feed.json', fallbackUrl: 'feed.json', updatedAt: generatedAt }
  await fs.mkdir(path.dirname(datasetPath), { recursive: true })
  await fs.mkdir(diagnosticsDir, { recursive: true })
  await Promise.all([
    fs.writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`),
    fs.writeFile(controlPath, `${JSON.stringify(control, null, 2)}\n`),
    fs.writeFile(path.join(diagnosticsDir, `${batchId}.json`), `${JSON.stringify(diagnostics, null, 2)}\n`),
    fs.writeFile(path.join(diagnosticsDir, 'latest.json'), `${JSON.stringify(diagnostics, null, 2)}\n`),
  ])
  console.log(JSON.stringify({ batchId, ...diagnostics.outcome }, null, 2))
}

await main()
