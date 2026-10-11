import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeSentences, tokens } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { trustedContextDomain } from './enrich-generation-context.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { fetchPublicArticle } from './public-article.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDED_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'x.com']

function parseArgs(argv) {
  const options = { input: null, output: null, maximum: 15, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index]
    else if (argv[index] === '--output') options.output = argv[++index]
    else if (argv[index] === '--maximum') options.maximum = Number(argv[++index])
    else if (argv[index] === '--dry-run') options.dryRun = true
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required')
  if (!Number.isInteger(options.maximum) || options.maximum < 1 || options.maximum > 20) throw new Error('--maximum must be from 1 to 20')
  return options
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|error|code|lang)$/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

export function normalizeVerificationResult(result) {
  const accepted = [...new Map((result.accepted || []).map(source => [String(source.domain || '').toLowerCase(), source])).values()]
  const status = result.status === 'search-failed' ? result.status
    : accepted.length >= 2 ? 'two-supporting-source-families-found'
      : accepted.length === 1 ? 'one-supporting-source-family-found' : 'unresolved'
  return { ...result, accepted, status }
}

export function verificationCandidates(report, maximum = 15) {
  if (Array.isArray(report.withheld)) {
    const rank = value => value === 'strong' ? 0 : value === 'baseline-qualified' ? 1 : 2
    return report.withheld.filter(value => (value.gapRecoveryRequested || (value.lane?.endsWith('major')
      && ['strong', 'baseline-qualified'].includes(value.editorialRecommendation)))
      && ['needs-independent-corroboration', 'needs-source-review', 'needs-independent-context', 'replace-source'].includes(value.sourceAssessment?.decision))
      .map(value => ({
        ...value,
        blindId: value.blindId || value.eventId,
        destination: value.lane,
        source: value.primarySource,
        evaluation: { recommendation: value.editorialRecommendation, strongest_fact: value.evidence },
      }))
      .sort((a, b) => rank(a.editorialRecommendation) - rank(b.editorialRecommendation)
        || Number(b.editorialScore || 0) - Number(a.editorialScore || 0)
        || Number(a.baselineRank || 9999) - Number(b.baselineRank || 9999))
      .slice(0, maximum)
  }
  return report.results.filter(value => value.evaluation.recommendation === 'strong'
    && /(?:interesting|discovery)$/.test(value.destination)
    && value.sourceAssessment.decision !== 'provisionally-usable')
    .sort((a, b) => b.editorialScore - a.editorialScore)
    .slice(0, maximum)
}

export function relevantCandidate(story, candidate) {
  const storyTerms = tokens(`${story.headline} ${story.evaluation.strongest_fact}`)
  const candidateTerms = tokens(`${candidate.title} ${candidate.evidenceText.slice(0, 1400)}`)
  const shared = [...storyTerms].filter(term => candidateTerms.has(term))
  return { passes: shared.length >= Math.min(4, Math.max(2, Math.ceil(storyTerms.size * 0.18))), sharedTerms: shared }
}

async function search(apiKey, story) {
  const body = {
    query: `${story.headline} ${story.evaluation.strongest_fact}`,
    objective: 'Find the original primary document, research paper, official record, or a genuinely independent established report that directly supports this same story. Avoid copied articles, syndications, generic topic pages, and unrelated background.',
    type: 'auto', numResults: 6, moderation: true, excludeDomains: EXCLUDED_DOMAINS,
  }
  const started = performance.now()
  const response = await fetch(API_URL, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await response.text()
  let payload = null
  try { payload = JSON.parse(raw) } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.error || raw.slice(0, 180)}`)
  return { results: payload?.results || [], costDollars: Number(payload?.costDollars?.total || 0), requestId: payload?.requestId || null, latencyMs: Math.round(performance.now() - started) }
}

async function verifyStory(apiKey, story) {
  const found = await search(apiKey, story)
  const originalUrl = canonicalUrl(story.source.url)
  const accepted = [], rejected = []
  for (const result of found.results) {
    if (accepted.length >= 2) break
    const url = canonicalUrl(result.url)
    if (!url || url === originalUrl) continue
    try {
      const article = await fetchPublicArticle(url)
      const finalUrl = canonicalUrl(article.finalUrl)
      if (finalUrl === originalUrl) continue
      const domain = new URL(finalUrl).hostname.replace(/^www\./, '')
      const quality = assessExtractedEvidence(article.evidenceText)
      const relevance = relevantCandidate(story, { title: article.title || result.title, evidenceText: article.evidenceText })
      const propositions = completeSentences(article.evidenceText, { maxChars: 3200, maxSentences: 8 }).slice(0, 6)
      const reasons = [...quality.reasons]
      if (!relevance.passes) reasons.push('insufficient event overlap')
      if (!trustedContextDomain(domain)) reasons.push('domain is not in the trusted context registry')
      if (propositions.length < 2) reasons.push('insufficient complete propositions')
      if (reasons.length) {
        rejected.push({ url: finalUrl, title: article.title || result.title, domain, reasons })
        continue
      }
      accepted.push({
        title: article.title || result.title, domain, url: finalUrl,
        publishedAt: result.publishedDate || null, sharedTerms: relevance.sharedTerms,
        propositions,
      })
    } catch (error) {
      rejected.push({ url, title: result.title, domain: null, reasons: [String(error?.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 180)] })
    }
  }
  return normalizeVerificationResult({
    blindId: story.blindId, eventId: story.eventId || null, headline: story.headline, destination: story.destination,
    originalSource: story.source, originalSourceAssessment: story.sourceAssessment,
    status: 'unresolved', accepted, rejected, requestId: found.requestId,
    costDollars: found.costDollars, latencyMs: found.latencyMs,
  })
}

function markdown(report) {
  const lines = ['# Shortlist source verification', '', `Created: ${report.createdAt}`, '', `Exa searches: ${report.searches}; reported cost: $${report.costDollars.toFixed(3)}.`, '']
  report.results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.headline}`, '', `Status: ${result.status}`, '', `Original: [${result.originalSource.publisher}](${result.originalSource.url}) — ${result.originalSourceAssessment.decision}`, '')
    result.accepted.forEach(source => lines.push(`- Supporting source: [${source.domain}](${source.url})`))
    if (!result.accepted.length) lines.push('- No suitable trusted supporting source found in this search.')
    lines.push('')
  })
  return `${lines.join('\n')}\n`
}

async function saveCheckpoint(options, results, { complete = false } = {}) {
  results = results.map(normalizeVerificationResult)
  const output = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceReport: options.input, complete,
    searches: results.filter(value => value.requestAttempted).length,
    costDollars: Number(results.reduce((sum, value) => sum + Number(value.costDollars || 0), 0).toFixed(6)),
    totalLatencyMs: results.reduce((sum, value) => sum + Number(value.latencyMs || 0), 0), results,
  }
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  await fs.writeFile(options.output.replace(/\.json$/i, '.md'), markdown(output), 'utf8')
  return output
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await fs.readFile(options.input, 'utf8'))
  const candidates = verificationCandidates(report, options.maximum)
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ candidates: candidates.length, maximumSearches: candidates.length, estimatedCostDollarsAtPreviousObservedRate: Number((candidates.length * 0.007).toFixed(3)), headlines: candidates.map(value => value.headline) }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  let results = []
  try {
    const existing = JSON.parse(await fs.readFile(options.output, 'utf8'))
    results = Array.isArray(existing.results) ? existing.results : []
  } catch {}
  const completedIds = new Set(results.map(value => value.blindId))
  for (const story of candidates.filter(value => !completedIds.has(value.blindId))) {
    try {
      results.push({ ...(await verifyStory(apiKey, story)), requestAttempted: true })
    } catch (error) {
      results.push({
        blindId: story.blindId, eventId: story.eventId || null, headline: story.headline, destination: story.destination,
        originalSource: story.source, originalSourceAssessment: story.sourceAssessment,
        status: 'search-failed', accepted: [], rejected: [], requestAttempted: true,
        costDollars: 0, latencyMs: 0, error: String(error?.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 240),
      })
    }
    await saveCheckpoint(options, results)
  }
  const output = await saveCheckpoint(options, results, { complete: results.length === candidates.length })
  process.stdout.write(`${JSON.stringify({ searches: output.searches, costDollars: output.costDollars, totalLatencyMs: output.totalLatencyMs, statuses: Object.fromEntries([...new Set(output.results.map(value => value.status))].map(status => [status, output.results.filter(value => value.status === status).length])) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
