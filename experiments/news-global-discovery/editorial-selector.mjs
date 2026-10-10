import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { parseStrict } from '../../artifacts/summary-feasibility/round-9/strict-json.mjs'

export const MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const INCLUDED_LANES = new Set(['world-interesting', 'priority-interesting', 'discovery'])
export const SELECTOR_CONFIGURATION = Object.freeze({
  model: MODEL,
  temperature: 0.1,
  maxCompletionTokens: 1800,
  batchSize: 8,
  thinking: false,
  retries: 0,
})

const HIGH_SIGNAL = /\b(?:killed?|deaths?|died|injured?|missing|displaced|detained|arrested|evicted|without (?:water|toilets?|electricity)|rights?|ban(?:ned)?|court|lawsuit|pollution|erosion|destroyed|restor(?:e|ed|ation)|first|oldest|largest|million|billion|percent|study|researchers?|fossil|discovered?|evidence|suggests?|reveals?|found)\b/i
const EXTRACTION_JUNK = /(?:\{\s*(?:font|margin|padding|display|width|border|color)|\b(?:font-size|padding-top|margin-bottom|cursor|stylesheet|javascript|cookies? not supported|thank you for visiting|browser version with limited support|compatibility mode in internet explorer)\b|\b\d+(?:\.\d+)?(?:rem|px)\b|^\s*[.#][\w-]+\s)/i

function parseArgs(argv) {
  const options = { edition: null, fixture: null, prepareFixture: null, outputDir: null, resume: null, batchSize: SELECTOR_CONFIGURATION.batchSize }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--edition') options.edition = argv[++index]
    else if (argv[index] === '--fixture') options.fixture = argv[++index]
    else if (argv[index] === '--prepare-fixture') options.prepareFixture = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--resume') options.resume = argv[++index]
    else if (argv[index] === '--batch-size') options.batchSize = Number(argv[++index])
  }
  if (options.prepareFixture && !options.edition) throw new Error('--edition is required with --prepare-fixture')
  if (!options.prepareFixture && (!options.fixture || !options.outputDir)) throw new Error('Use --fixture and --output-dir to run scoring')
  if (!Number.isInteger(options.batchSize) || options.batchSize < 2 || options.batchSize > 10) throw new Error('--batch-size must be from 2 to 10')
  return options
}

function sentences(text) {
  return completeSentences(text, { maxChars: 20_000, maxSentences: 100 })
}

export function compactEvidence(text, { maxChars = 3200 } = {}) {
  const all = sentences(text).filter(sentence => !EXTRACTION_JUNK.test(sentence))
  const selected = []
  const add = sentence => {
    const normalized = sentence.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!normalized || selected.some(item => item.normalized === normalized)) return
    selected.push({ sentence, normalized })
  }
  all.slice(0, 7).forEach(add)
  all.filter(sentence => HIGH_SIGNAL.test(sentence)).slice(0, 8).forEach(add)
  all.slice(-2).forEach(add)
  const output = []
  let used = 0
  for (const { sentence } of selected) {
    if (used + sentence.length + 1 > maxChars) continue
    output.push(sentence)
    used += sentence.length + 1
  }
  return output.join(' ')
}

export function prepareEditorialFixture(edition) {
  const selected = edition.events.filter(event => INCLUDED_LANES.has(event.representative.selection.assignedLane))
  const reserve = (edition.qualifiedButNotSelected || []).filter(event => INCLUDED_LANES.has(event.representative.selection.assignedLane))
  const events = [...selected, ...reserve]
  const prepared = events.map((event, index) => {
    const item = event.representative
    return {
      blindId: `E${String(index + 1).padStart(3, '0')}`,
      eventId: event.id,
      lane: item.selection.assignedLane,
      priorityRegions: item.selection.representative.priorityRegions || [],
      headline: item.snapshot.title,
      evidence: compactEvidence(item.snapshot.evidenceText),
      publishedAt: item.snapshot.publishedAt,
      baselineSelected: selected.includes(event),
      baselineRank: selected.includes(event) ? edition.events.indexOf(event) + 1 : null,
      source: {
        publisher: item.snapshot.publisher,
        url: item.snapshot.finalUrl || item.snapshot.sourceUrl,
      },
    }
  })
  const candidates = prepared.filter(value => value.evidence.length >= 180)
  const excluded = prepared.filter(value => value.evidence.length < 180).map(value => ({
    blindId: value.blindId, eventId: value.eventId, headline: value.headline,
    reason: 'less than 180 characters of usable evidence remained after boilerplate removal',
  }))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    purpose: 'Blind editorial-selection experiment; publisher identity is withheld from the model.',
    candidates,
    excluded,
  }
}

export function chunks(values, size) {
  const output = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

const rubric = `You are an exacting editorial selector for a personal news product. Judge only the supplied evidence. Do not add facts from memory. Publisher identity has already been evaluated separately and is intentionally hidden.

The lanes have different purposes:
- world-interesting: a concrete, genuinely interesting story from anywhere. Reward human significance, a revealing window into a place or way of life, surprise with substance, and the feeling that a curious reader would be glad to have learned it. "Quirky" alone is not enough.
- priority-interesting: the same quality bar, but about Syria, the wider Middle East, Bangladesh, Ghana, Canada or the GTA. Regional relevance routes a story; it does not make a weak story good.
- discovery: a specific newly reported scientific, archaeological, psychological, natural-world or historical finding that a non-specialist can understand. Penalize generic reviews, vague explainers, institutional publicity and jargon without a concrete finding.

Score every dimension from 0 (absent/bad) to 5 (exceptional):
- lane_fit: actually belongs in its assigned lane.
- substantive_value: meaningful human/place insight for Interesting, or a concrete new finding for Discovery.
- intrinsic_interest: likely to make a curious general reader want to keep reading.
- distinctiveness: teaches something not interchangeable with routine coverage.
- clarity: the central fact and why it matters are understandable from the evidence.
- freshness_specificity: a specific recent report/development/finding, rather than generic background or recycled material.

Use recommendation "strong" only when you would actively choose the story; "possible" when worthwhile but replaceable; "reject" when it should not consume scarce feed space. Identify the single strongest supported fact. Keep reasons concise.`

export function scoreSchema(maxItems = 10) {
  return {
    name: 'doomscroller_editorial_scores',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['evaluations'],
      properties: {
        evaluations: {
          type: 'array', minItems: 1, maxItems,
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'lane_fit', 'substantive_value', 'intrinsic_interest', 'distinctiveness', 'clarity', 'freshness_specificity', 'recommendation', 'strongest_fact', 'reason'],
            properties: {
              id: { type: 'string' },
              lane_fit: { type: 'integer', minimum: 0, maximum: 5 },
              substantive_value: { type: 'integer', minimum: 0, maximum: 5 },
              intrinsic_interest: { type: 'integer', minimum: 0, maximum: 5 },
              distinctiveness: { type: 'integer', minimum: 0, maximum: 5 },
              clarity: { type: 'integer', minimum: 0, maximum: 5 },
              freshness_specificity: { type: 'integer', minimum: 0, maximum: 5 },
              recommendation: { type: 'string', enum: ['strong', 'possible', 'reject'] },
              strongest_fact: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
  }
}

function credentials() {
  if (process.env.FREE_PLAN_CONFIRMED !== 'yes') throw new Error('FREE_PLAN_CONFIRMED=yes is required; no paid fallback exists')
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare credentials are missing')
  return { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN }
}

const safeHeaders = response => Object.fromEntries([...response.headers].filter(([name]) =>
  /^(?:cf-ray|retry-after|(?:x-)?request-id|x-correlation-id|(?:x-)?ratelimit[\w-]*|x-rate-limit[\w-]*)$/i.test(name)))

function exposedResponse(body) {
  const result = body?.result
  return result?.response ?? result?.choices?.[0]?.message?.content ?? null
}

export function auditBatch(parsed, expectedIds) {
  const evaluations = parsed?.evaluations
  if (!Array.isArray(evaluations)) return { valid: false, reason: 'evaluations array missing' }
  const ids = evaluations.map(value => value?.id)
  if (new Set(ids).size !== ids.length) return { valid: false, reason: 'duplicate candidate id' }
  if (ids.length !== expectedIds.length || expectedIds.some(id => !ids.includes(id))) return { valid: false, reason: 'candidate ids do not exactly match batch' }
  const scoresValid = evaluations.every(value => ['lane_fit', 'substantive_value', 'intrinsic_interest', 'distinctiveness', 'clarity', 'freshness_specificity']
    .every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 5))
  if (!scoresValid) return { valid: false, reason: 'score outside integer 0-5 range' }
  if (!evaluations.every(value => ['strong', 'possible', 'reject'].includes(value.recommendation) && value.strongest_fact && value.reason)) return { valid: false, reason: 'recommendation or explanation missing' }
  return { valid: true, reason: null }
}

async function scoreBatch(candidates, batchIndex) {
  const { accountId, token } = credentials()
  const publicCandidates = candidates.map(({ blindId, lane, priorityRegions, headline, evidence, publishedAt }) => ({ id: blindId, lane, priority_regions: priorityRegions, headline, evidence, published_at: publishedAt }))
  const request = {
    messages: [{ role: 'system', content: rubric }, { role: 'user', content: JSON.stringify({ candidates: publicCandidates }) }],
    temperature: SELECTOR_CONFIGURATION.temperature,
    max_completion_tokens: SELECTOR_CONFIGURATION.maxCompletionTokens,
    response_format: { type: 'json_schema', json_schema: scoreSchema(candidates.length) },
    chat_template_kwargs: { enable_thinking: false },
    store: false,
  }
  const timestamp = new Date().toISOString(), started = performance.now()
  let response, raw
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(request), signal: AbortSignal.timeout(55_000),
    })
    raw = await response.text()
  } catch (error) {
    return { batchIndex, timestamp, complete: false, state: 'provider_network_failure', error: error.name, latencyMs: Math.round(performance.now() - started) }
  }
  let body = null, providerParseError = null
  try { body = parseStrict(raw) } catch (error) { providerParseError = error.message }
  const exposed = exposedResponse(body)
  let parsed = exposed && typeof exposed === 'object' ? exposed : null, parseError = null
  if (typeof exposed === 'string') try { parsed = parseStrict(exposed) } catch (error) { parseError = error.message }
  const audit = auditBatch(parsed, candidates.map(value => value.blindId))
  const result = body?.result, finishReason = result?.choices?.[0]?.finish_reason ?? null
  const complete = response.ok && body?.success !== false && !providerParseError && !parseError && audit.valid && (finishReason === null || finishReason === 'stop')
  return {
    batchIndex, timestamp, finishedAt: new Date().toISOString(), complete,
    requestedModel: MODEL, returnedModel: result?.model ?? null, httpStatus: response.status,
    internalErrors: body?.errors ?? [], latencyMs: Math.round(performance.now() - started),
    usage: result?.usage ?? body?.usage ?? null, finishReason, safeHeaders: safeHeaders(response),
    providerParseError, parseError, audit, evaluations: parsed?.evaluations ?? [],
  }
}

export function computedScore(value) {
  const weighted = value.lane_fit * 0.05 + value.substantive_value * 0.25 + value.intrinsic_interest * 0.25
    + value.distinctiveness * 0.2 + value.clarity * 0.15 + value.freshness_specificity * 0.1
  return Math.round(weighted * 20)
}

export function combineScores(fixture, batches) {
  const byId = new Map(batches.flatMap(batch => batch.evaluations || []).map(value => [value.id, value]))
  return fixture.candidates.map(candidate => {
    const evaluation = byId.get(candidate.blindId)
    if (!evaluation) return { ...candidate, evaluation: null, editorialScore: null }
    return { ...candidate, evaluation, editorialScore: computedScore(evaluation) }
  }).sort((a, b) => {
    if (a.lane !== b.lane) return a.lane.localeCompare(b.lane)
    return b.editorialScore - a.editorialScore || a.baselineRank - b.baselineRank
  })
}

function reviewMarkdown(report, includeSources = false) {
  const title = includeSources ? '# Editorial selector answer key' : '# Blind editorial selector review'
  const lines = [title, '', `Scored: ${report.createdAt}`, '', 'This is a diagnostic ranking, not a production feed. Scores judge the story idea from supplied evidence; source trust was gated separately.', '']
  for (const lane of ['world-interesting', 'priority-interesting', 'discovery']) {
    lines.push(`## ${lane}`, '')
    report.results.filter(value => value.lane === lane).forEach((value, index) => {
      lines.push(`### ${index + 1}. ${value.headline}`, '', `Score: ${value.editorialScore}/100 · ${value.evaluation.recommendation}`, '', value.evaluation.strongest_fact, '', `Why: ${value.evaluation.reason}`, '')
      if (includeSources) lines.push(`Source: [${value.source.publisher}](${value.source.url})`, value.baselineSelected ? `Baseline qualified-edition rank: ${value.baselineRank}` : 'Baseline: qualified reserve (not selected by the old ranking)', '')
    })
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.prepareFixture) {
    const edition = JSON.parse(await fs.readFile(options.edition, 'utf8'))
    const fixture = prepareEditorialFixture(edition)
    await fs.mkdir(path.dirname(options.prepareFixture), { recursive: true })
    await fs.writeFile(options.prepareFixture, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({ candidates: fixture.candidates.length, excluded: fixture.excluded.length, lanes: Object.fromEntries([...INCLUDED_LANES].map(lane => [lane, fixture.candidates.filter(value => value.lane === lane).length])), output: options.prepareFixture }, null, 2)}\n`)
    return
  }
  const fixture = JSON.parse(await fs.readFile(options.fixture, 'utf8'))
  let priorReport = null
  if (options.resume) priorReport = JSON.parse(await fs.readFile(options.resume, 'utf8'))
  const candidateIds = new Set(fixture.candidates.map(value => value.blindId))
  const resumedEvaluations = (priorReport?.calls || []).flatMap(call => call.evaluations || [])
    .filter(value => candidateIds.has(value.id) && auditBatch({ evaluations: [value] }, [value.id]).valid)
  const resumedById = new Map(resumedEvaluations.map(value => [value.id, value]))
  const pending = fixture.candidates.filter(value => !resumedById.has(value.blindId))
  const calls = []
  for (const [index, batch] of chunks(pending, options.batchSize).entries()) {
    const result = await scoreBatch(batch, index + 1)
    calls.push(result)
    if (!result.complete) break
  }
  const evaluations = [...resumedById.values(), ...calls.flatMap(value => value.evaluations || [])]
  const complete = fixture.candidates.every(value => evaluations.some(evaluation => evaluation.id === value.blindId)) && calls.every(value => value.complete)
  const results = complete ? combineScores(fixture, [{ evaluations }]) : []
  const priorNeurons = Number(priorReport?.totalNeurons || 0)
  const priorInputTokens = Number(priorReport?.inputTokens || 0)
  const priorOutputTokens = Number(priorReport?.outputTokens || 0)
  const thisRunNeurons = calls.reduce((sum, value) => sum + Number(value.usage?.neurons || 0), 0)
  const thisRunInputTokens = calls.reduce((sum, value) => sum + Number(value.usage?.prompt_tokens || value.usage?.input_tokens || 0), 0)
  const thisRunOutputTokens = calls.reduce((sum, value) => sum + Number(value.usage?.completion_tokens || value.usage?.output_tokens || 0), 0)
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceFixture: options.fixture,
    configuration: { ...SELECTOR_CONFIGURATION, batchSize: options.batchSize }, complete,
    candidateCount: fixture.candidates.length, excludedBeforeScoring: fixture.excluded || [],
    resumedFrom: options.resume, resumedEvaluations: resumedById.size, pendingCandidates: pending.length,
    completedBatches: calls.filter(value => value.complete).length, totalBatches: Math.ceil(pending.length / options.batchSize),
    thisRunNeurons, inputTokens: thisRunInputTokens, outputTokens: thisRunOutputTokens,
    priorUsage: priorReport ? { neurons: priorNeurons, inputTokens: priorInputTokens, outputTokens: priorOutputTokens } : null,
    experimentNeurons: priorNeurons + thisRunNeurons, totalNeurons: priorNeurons + thisRunNeurons,
    totalLatencyMs: calls.reduce((sum, value) => sum + Number(value.latencyMs || 0), 0),
    calls, results,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  const writes = [fs.writeFile(path.join(options.outputDir, 'EDITORIAL_SCORES.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')]
  if (complete) writes.push(
    fs.writeFile(path.join(options.outputDir, 'BLIND_EDITORIAL_REVIEW.md'), reviewMarkdown(report), 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'EDITORIAL_ANSWER_KEY.md'), reviewMarkdown(report, true), 'utf8'),
  )
  await Promise.all(writes)
  process.stdout.write(`${JSON.stringify({ complete, candidateCount: report.candidateCount, resumedEvaluations: report.resumedEvaluations, pendingCandidates: report.pendingCandidates, completedBatches: report.completedBatches, totalBatches: report.totalBatches, thisRunNeurons: report.thisRunNeurons, experimentNeurons: report.experimentNeurons, inputTokens: report.inputTokens, outputTokens: report.outputTokens, totalLatencyMs: report.totalLatencyMs }, null, 2)}\n`)
  if (!complete) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
