import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { completeSentences, tokens } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { fetchPublicArticle } from './public-article.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDED_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'x.com']
const EXACT_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i
const TRUSTED_CONTEXT_DOMAINS = new Set([
  'apnews.com', 'reuters.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com', 'theguardian.com', 'npr.org',
  'cbc.ca', 'globalnews.ca', 'ctvnews.ca', 'politico.eu', 'gothamist.com', 'nature.com', 'sciencemag.org',
  'news.mongabay.com', 'automotiveworld.com', 'thedailystar.net', 'tbsnews.net', 'dhakatribune.com',
  'thefinancialexpress.com.bd', 'myjoyonline.com', 'citinewsroom.com', 'graphic.com.gh', 'gna.org.gh',
  'chale.news', 'icc-cpi.int', 'who.int', 'un.org', 'canada.ca', 'parl.ca',
])

function parseArgs(argv) {
  const options = { input: null, output: null, maxSources: 2, maxEvents: 10, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index]
    else if (argv[index] === '--output') options.output = argv[++index]
    else if (argv[index] === '--max-sources') options.maxSources = Number(argv[++index])
    else if (argv[index] === '--max-events') options.maxEvents = Number(argv[++index])
    else if (argv[index] === '--dry-run') options.dryRun = true
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required')
  if (!Number.isInteger(options.maxSources) || options.maxSources < 1 || options.maxSources > 3) throw new Error('--max-sources must be 1-3')
  if (!Number.isInteger(options.maxEvents) || options.maxEvents < 1 || options.maxEvents > 20) throw new Error('--max-events must be 1-20')
  return options
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|error|code)$/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

function relevant(eventTitle, candidateTitle, evidenceText) {
  const eventTerms = tokens(eventTitle)
  const candidateTerms = tokens(`${candidateTitle} ${evidenceText.slice(0, 1200)}`)
  const shared = [...eventTerms].filter(term => candidateTerms.has(term))
  return { passes: shared.length >= Math.min(3, Math.max(2, eventTerms.size)), sharedTerms: shared }
}

function contextFacts(text) {
  return completeSentences(text, { maxChars: 3600, maxSentences: 10 })
    .filter(sentence => !EXACT_DATE.test(sentence))
    .slice(0, 8)
}

export function trustedContextDomain(domain) {
  const normalized = String(domain || '').replace(/^www\./, '').toLowerCase()
  if (TRUSTED_CONTEXT_DOMAINS.has(normalized)) return true
  if ([...TRUSTED_CONTEXT_DOMAINS].some(known => normalized.endsWith(`.${known}`))) return true
  return /(?:\.gov(?:\.[a-z]{2})?|\.gc\.ca|\.edu|\.ac\.[a-z]{2}|\.int)$/.test(normalized)
    || /^(?:news|research|science|medicine|engineering|law|policy|biologicalsciences)\.[a-z0-9-]+\.edu$/.test(normalized)
}

async function search(apiKey, item) {
  const body = {
    query: `${item.sourceTitle} explained background significance criticism`,
    objective: 'Find an authoritative primary document or strong independent explainer that directly clarifies what this event, law, institution, policy, person, or scientific finding is; how it works; why it matters; and any important supported disagreement. Avoid duplicate syndications and unrelated background.',
    type: 'auto', numResults: 5, moderation: true, excludeDomains: EXCLUDED_DOMAINS,
  }
  const started = performance.now()
  const response = await fetch(API_URL, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await response.text()
  let payload = null
  try { payload = JSON.parse(raw) } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.error || raw.slice(0, 200)}`)
  return { results: payload?.results || [], costDollars: Number(payload?.costDollars?.total || 0), requestId: payload?.requestId || null, latencyMs: Math.round(performance.now() - started) }
}

async function enrichItem(apiKey, item, maxSources) {
  const found = await search(apiKey, item)
  const existing = new Set(item.sources.map(source => canonicalUrl(source.url)))
  const additions = [], rejected = []
  for (const result of found.results) {
    if (additions.length >= maxSources) break
    const url = canonicalUrl(result.url)
    if (!url || existing.has(url)) continue
    try {
      const article = await fetchPublicArticle(url)
      const quality = assessExtractedEvidence(article.evidenceText)
      const relevance = relevant(item.sourceTitle, article.title || result.title, article.evidenceText)
      const propositions = contextFacts(article.evidenceText)
      if (!quality.adequate || !relevance.passes || propositions.length < 2) {
        rejected.push({ url, title: article.title || result.title, reasons: [...quality.reasons, ...(!relevance.passes ? ['insufficient event-title overlap'] : []), ...(propositions.length < 2 ? ['too little usable context'] : [])] })
        continue
      }
      const finalUrl = canonicalUrl(article.finalUrl)
      const publisher = new URL(finalUrl).hostname.replace(/^www\./, '')
      if (!trustedContextDomain(publisher)) {
        rejected.push({ url: finalUrl, title: article.title || result.title, reasons: ['publisher is not in the trusted context-source registry'] })
        continue
      }
      additions.push({
        sourceId: `context:${item.eventId}:${additions.length + 1}`, publisher, url: finalUrl,
        publishedAt: result.publishedDate || null, updatedAt: null, access: 'ok', wireOrigin: null,
        sourceType: 'context source', completeFactualPropositions: propositions,
        limitations: ['Use this source only for supported orientation, mechanism, significance, status, or disagreement. Do not treat it as independent confirmation of the central event unless it directly reports that event.'],
      })
      existing.add(finalUrl)
    } catch (error) {
      rejected.push({ url, title: result.title, reasons: [String(error?.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 180)] })
    }
  }
  const temporalPacket = structuredClone(item.temporalPacket)
  temporalPacket.writer_facing.secondarySourceAdditions = [...(temporalPacket.writer_facing.secondarySourceAdditions || []), ...additions]
  temporalPacket.writer_facing.provenance = [...(temporalPacket.writer_facing.provenance || []), ...additions.map(source => ({ sourceId: source.sourceId, publisher: source.publisher, url: source.url, wireOrigin: null, sourceType: source.sourceType }))]
  temporalPacket.writer_facing.curatorInstructions = [...(temporalPacket.writer_facing.curatorInstructions || []), 'For an unfamiliar law, policy, institution, person, place, or scientific concept, weave in only the minimum supplied context needed to understand what it is, how it works, why it matters, and any important supported disagreement. Do not create a separate generic background section or pad familiar events.']
  return { ...item, temporalPacket, contextEnrichment: { requestId: found.requestId, costDollars: found.costDollars, latencyMs: found.latencyMs, additions: additions.map(({ completeFactualPropositions, ...source }) => ({ ...source, propositionCount: completeFactualPropositions.length })), rejected } }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const fixture = JSON.parse(await fs.readFile(options.input, 'utf8'))
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ events: Math.min(options.maxEvents, fixture.items.length), maximumSearches: Math.min(options.maxEvents, fixture.items.length), estimatedCostDollars: Number((Math.min(options.maxEvents, fixture.items.length) * 0.007).toFixed(3)) }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  const items = []
  for (const [index, item] of fixture.items.entries()) items.push(index < options.maxEvents ? await enrichItem(apiKey, item, options.maxSources) : item)
  const output = {
    ...fixture, schemaVersion: 2, createdAt: new Date().toISOString(), sourceFixture: options.input,
    contextEnrichment: {
      searchedEvents: Math.min(options.maxEvents, fixture.items.length),
      costDollars: Number(items.reduce((sum, item) => sum + Number(item.contextEnrichment?.costDollars || 0), 0).toFixed(6)),
      addedSources: items.reduce((sum, item) => sum + Number(item.contextEnrichment?.additions?.length || 0), 0),
    },
    items,
  }
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(output.contextEnrichment, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
