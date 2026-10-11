import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStrict } from '../../artifacts/summary-feasibility/round-9/strict-json.mjs'

export const MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const CONFIGURATION = Object.freeze({ model: MODEL, temperature: 0.1, maxCompletionTokens: 1600, batchSize: 8, thinking: false, retries: 0 })

const ESTABLISHED = new Set([
  'abc.net.au', 'al-monitor.com', 'aljazeera.com', 'arabnews.com', 'bbc.co.uk', 'bbc.com', 'cbc.ca',
  'channelnewsasia.com', 'cp24.com', 'dailysabah.com', 'dtinews.dantri.com.vn', 'english.aawsat.com',
  'etvbharat.com', 'groundup.news', 'gulfnews.com', 'hawaiinewsnow.com', 'kyivindependent.com',
  'mainichi.jp', 'malaysiakini.com', 'myjoyonline.com', 'npr.org', 'paherald.sk.ca', 'seattletimes.com',
  'straitstimes.com', 'thedailystar.net', 'thefinancialexpress.com.bd', 'theguardian.com', 'thenarwhal.ca',
  'thenationalnews.com', 'thepointer.com', 'toronto.citynews.ca', 'vanityfair.com', 'wired.com',
])
const RESEARCH_OR_INSTITUTIONAL = new Set([
  'nature.com', 'news.uchicago.edu', 'phys.org', 'medicalxpress.com', 'researchmatters.in',
  'theconversation.com', 'space.com', 'huggingface.co', 'wwt.org.uk',
])
const REPLACE_SOURCE = new Set(['scienmag.com', 'techtimes.com', 'torontosun.com'])
const HIGH_RISK = /\b(?:alleg(?:e|ed|es|ation)|accus(?:e|ed|es|ation)|attack|killing|killed|abuse|gunmen|war|military|soldiers?|detention|homicide|murder|corrupt|forg(?:e|ed|ery)|election|ballot|protests?|illegal min(?:e|er|ing)|sanctions?|police|court|crime|criminal|territory|recapture|sabotage)\b/i

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '')
}

export function sourceAssessment(candidate) {
  const domain = normalizeDomain(candidate.source?.publisher)
  const risky = HIGH_RISK.test(`${candidate.headline} ${candidate.evaluation?.strongest_fact || ''}`)
  if (REPLACE_SOURCE.has(domain)) return { domain, tier: 'weak-or-derivative', decision: 'replace-source', reason: 'Do not write from this publisher; locate the original research or an established independent report.' }
  if (risky) return { domain, tier: ESTABLISHED.has(domain) ? 'established' : RESEARCH_OR_INSTITUTIONAL.has(domain) ? 'institutional' : 'unverified', decision: 'needs-independent-corroboration', reason: 'Conflict, crime, political or contested factual claims require another independent source family.' }
  if (RESEARCH_OR_INSTITUTIONAL.has(domain)) return { domain, tier: 'research-or-institutional', decision: 'needs-independent-context', reason: 'Use the primary or specialist material, then add an independent explainer or original paper where available.' }
  if (ESTABLISHED.has(domain)) return { domain, tier: 'established', decision: 'provisionally-usable', reason: 'Usable for low-risk selection, subject to normal evidence and extraction checks.' }
  return { domain, tier: 'unverified', decision: 'needs-source-review', reason: 'Publisher is not yet in the trusted registry; verify ownership, originality and editorial standards or replace it.' }
}

function parseArgs(argv) {
  const options = { fixture: null, scores: null, outputDir: null, batchSize: CONFIGURATION.batchSize }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fixture') options.fixture = argv[++index]
    else if (argv[index] === '--scores') options.scores = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--batch-size') options.batchSize = Number(argv[++index])
  }
  if (!options.fixture || !options.scores || !options.outputDir) throw new Error('--fixture, --scores, and --output-dir are required')
  if (!Number.isInteger(options.batchSize) || options.batchSize < 2 || options.batchSize > 10) throw new Error('--batch-size must be from 2 to 10')
  return options
}

export function prepareBoundaryCandidates(fixture, scores) {
  const evidence = new Map(fixture.candidates.map(value => [value.blindId, value.evidence]))
  return scores.results.filter(value => value.lane.endsWith('interesting') && value.evaluation.recommendation !== 'reject').map(value => ({
    id: value.blindId,
    current_lane: value.lane,
    headline: value.headline,
    strongest_supported_fact: value.evaluation.strongest_fact,
    evidence: evidence.get(value.blindId) || '',
  })).filter(value => value.evidence.length >= 180)
}

export function chunks(values, size) {
  const output = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

const prompt = `You are enforcing the boundary between two sections of a personal news product. Judge only the supplied evidence and do not add facts from memory.

MAJOR NEWS is selected primarily because a fresh action or development is consequential: government or public policy, elections, war and military operations, courts, major crime, economic decisions, disasters, public health, or a high-impact investigation. Investigative writing can be vivid and still belong in Major News.

INTERESTING is selected primarily because it gives a revealing, specific window into people, a place, a livelihood, culture, an unusual local solution, or how life is changing. It must have substance, not merely be cute or quirky. An Interesting story may touch politics or conflict when its real value is the grounded human/place perspective rather than the headline development.

Choose exactly one destination:
- interesting: its principal editorial value is the human/place/curiosity angle.
- major: its principal editorial value is the consequential news development.
- reject: it is not strong enough for either scarce section.

Score 0-5 for human_place_value and major_news_value. A high score in both is allowed, but destination must identify the story's primary value. Keep the reason concise and identify what would be lost if it were placed in the wrong section.`

function schema(maxItems) {
  return {
    name: 'doomscroller_lane_boundary', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['decisions'],
      properties: {
        decisions: {
          type: 'array', minItems: 1, maxItems,
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'destination', 'human_place_value', 'major_news_value', 'reason'],
            properties: {
              id: { type: 'string' }, destination: { type: 'string', enum: ['interesting', 'major', 'reject'] },
              human_place_value: { type: 'integer', minimum: 0, maximum: 5 },
              major_news_value: { type: 'integer', minimum: 0, maximum: 5 },
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

const safeHeaders = response => Object.fromEntries([...response.headers].filter(([name]) => /^(?:cf-ray|retry-after|(?:x-)?request-id|x-correlation-id|(?:x-)?ratelimit[\w-]*|x-rate-limit[\w-]*)$/i.test(name)))

export function auditDecisions(parsed, expectedIds) {
  const decisions = parsed?.decisions
  if (!Array.isArray(decisions)) return { valid: false, reason: 'decisions array missing' }
  const ids = decisions.map(value => value?.id)
  if (new Set(ids).size !== ids.length) return { valid: false, reason: 'duplicate id' }
  if (ids.length !== expectedIds.length || expectedIds.some(id => !ids.includes(id))) return { valid: false, reason: 'ids do not exactly match batch' }
  const valid = decisions.every(value => ['interesting', 'major', 'reject'].includes(value.destination)
    && ['human_place_value', 'major_news_value'].every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 5)
    && value.reason)
  return { valid, reason: valid ? null : 'invalid destination, score, or reason' }
}

async function scoreBatch(candidates, batchIndex) {
  const { accountId, token } = credentials()
  const request = {
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ stories: candidates }) }],
    temperature: CONFIGURATION.temperature, max_completion_tokens: CONFIGURATION.maxCompletionTokens,
    response_format: { type: 'json_schema', json_schema: schema(candidates.length) },
    chat_template_kwargs: { enable_thinking: false }, store: false,
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
  const result = body?.result, exposed = result?.response ?? result?.choices?.[0]?.message?.content ?? null
  let parsed = exposed && typeof exposed === 'object' ? exposed : null, parseError = null
  if (typeof exposed === 'string') try { parsed = parseStrict(exposed) } catch (error) { parseError = error.message }
  const audit = auditDecisions(parsed, candidates.map(value => value.id))
  const finishReason = result?.choices?.[0]?.finish_reason ?? null
  const complete = response.ok && body?.success !== false && !providerParseError && !parseError && audit.valid && (finishReason === null || finishReason === 'stop')
  return {
    batchIndex, timestamp, finishedAt: new Date().toISOString(), complete, requestedModel: MODEL, returnedModel: result?.model ?? null,
    httpStatus: response.status, internalErrors: body?.errors ?? [], latencyMs: Math.round(performance.now() - started),
    usage: result?.usage ?? body?.usage ?? null, finishReason, safeHeaders: safeHeaders(response), providerParseError, parseError, audit,
    decisions: parsed?.decisions ?? [],
  }
}

export function combineSafeguards(scores, decisions) {
  const byId = new Map(decisions.map(value => [value.id, value]))
  return scores.results.map(candidate => {
    const boundary = byId.get(candidate.blindId) || null
    const source = sourceAssessment(candidate)
    let destination = candidate.lane
    if (boundary?.destination === 'major') destination = candidate.lane === 'priority-interesting' ? 'priority-major' : 'world-major'
    else if (boundary?.destination === 'reject') destination = 'reject'
    return { ...candidate, boundary, destination, sourceAssessment: source }
  })
}

function markdown(report, answerKey = false) {
  const lines = [answerKey ? '# Lane and source safeguard answer key' : '# Blind lane-boundary review', '', `Created: ${report.createdAt}`, '', 'This remains an isolated editorial diagnostic. It does not change the app feed.', '']
  for (const destination of ['world-interesting', 'priority-interesting', 'world-major', 'priority-major', 'discovery', 'reject']) {
    const items = report.results.filter(value => value.destination === destination && value.evaluation.recommendation !== 'reject')
    if (!items.length) continue
    lines.push(`## ${destination}`, '')
    items.sort((a, b) => b.editorialScore - a.editorialScore).forEach((value, index) => {
      lines.push(`### ${index + 1}. ${value.headline}`, '', `Editorial score: ${value.editorialScore}/100`, '')
      if (value.boundary) lines.push(`Boundary: human/place ${value.boundary.human_place_value}/5 · major-news ${value.boundary.major_news_value}/5`, '', value.boundary.reason, '')
      if (answerKey) lines.push(`Source: [${value.sourceAssessment.domain}](${value.source.url})`, `Source status: ${value.sourceAssessment.decision} — ${value.sourceAssessment.reason}`, '')
    })
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const fixture = JSON.parse(await fs.readFile(options.fixture, 'utf8'))
  const scores = JSON.parse(await fs.readFile(options.scores, 'utf8'))
  const candidates = prepareBoundaryCandidates(fixture, scores)
  const calls = []
  for (const [index, batch] of chunks(candidates, options.batchSize).entries()) {
    const result = await scoreBatch(batch, index + 1)
    calls.push(result)
    if (!result.complete) break
  }
  const decisions = calls.flatMap(value => value.decisions || [])
  const complete = calls.length === Math.ceil(candidates.length / options.batchSize) && calls.every(value => value.complete)
  const results = complete ? combineSafeguards(scores, decisions) : []
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceScores: options.scores, configuration: CONFIGURATION,
    complete, boundaryCandidateCount: candidates.length, completedBatches: calls.filter(value => value.complete).length,
    totalBatches: Math.ceil(candidates.length / options.batchSize),
    totalNeurons: calls.reduce((sum, value) => sum + Number(value.usage?.neurons || 0), 0),
    inputTokens: calls.reduce((sum, value) => sum + Number(value.usage?.prompt_tokens || value.usage?.input_tokens || 0), 0),
    outputTokens: calls.reduce((sum, value) => sum + Number(value.usage?.completion_tokens || value.usage?.output_tokens || 0), 0),
    totalLatencyMs: calls.reduce((sum, value) => sum + Number(value.latencyMs || 0), 0), calls, results,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  const writes = [fs.writeFile(path.join(options.outputDir, 'SAFEGUARD_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')]
  if (complete) writes.push(
    fs.writeFile(path.join(options.outputDir, 'BLIND_BOUNDARY_REVIEW.md'), markdown(report), 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'SAFEGUARD_ANSWER_KEY.md'), markdown(report, true), 'utf8'),
  )
  await Promise.all(writes)
  process.stdout.write(`${JSON.stringify({ complete, boundaryCandidateCount: report.boundaryCandidateCount, completedBatches: report.completedBatches, totalBatches: report.totalBatches, totalNeurons: report.totalNeurons, inputTokens: report.inputTokens, outputTokens: report.outputTokens, totalLatencyMs: report.totalLatencyMs }, null, 2)}\n`)
  if (!complete) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })

