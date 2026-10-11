import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { publisherFamily } from './event-corroboration.mjs'
import { trustedContextDomain } from './enrich-generation-context.mjs'
import { fetchPublicArticle } from './public-article.mjs'
import { normalizeVerificationResult, relevantCandidate, verificationSourceIsFresh } from './verify-shortlist-sources.mjs'

function args(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--verification') result.verification = argv[++index]
    else if (argv[index] === '--queue') result.queue = argv[++index]
    else if (argv[index] === '--output') result.output = argv[++index]
  }
  if (!result.verification || !result.queue || !result.output) throw new Error('--verification, --queue and --output are required')
  return result
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch { return String(value || '') }
}

export async function recheckResult(result, story) {
  const originalFamily = publisherFamily(result.originalSource?.publisher || '')
  const accepted = [...(result.accepted || [])]
  const acceptedFamilies = new Set(accepted.map(source => publisherFamily(source.domain)))
  const rechecked = []
  for (const prior of result.rejected || []) {
    const url = canonicalUrl(prior.url)
    if (!url || accepted.length >= 2) break
    try {
      const article = await fetchPublicArticle(url)
      const finalUrl = canonicalUrl(article.finalUrl)
      const domain = new URL(finalUrl).hostname.replace(/^www\./, '')
      const family = publisherFamily(domain)
      const quality = assessExtractedEvidence(article.evidenceText)
      const relevance = relevantCandidate(story, { title: article.title || prior.title, evidenceText: article.evidenceText })
      const propositions = completeSentences(article.evidenceText, { maxChars: 3200, maxSentences: 8 }).slice(0, 6)
      const reasons = [...quality.reasons]
      if (!relevance.passes) reasons.push('insufficient event overlap')
      if (!trustedContextDomain(domain)) reasons.push('domain is not in the trusted context registry')
      if (propositions.length < 2) reasons.push('insufficient complete propositions')
      if (family === originalFamily) reasons.push('same publisher family as the original source')
      if (acceptedFamilies.has(family)) reasons.push('duplicate supporting publisher family')
      if (!verificationSourceIsFresh(story.publishedAt, article.publishedAt)) reasons.push('supporting report is stale or has no verifiable publication time')
      if (reasons.length) {
        rechecked.push({ url: finalUrl, title: article.title || prior.title, domain, publishedAt: article.publishedAt, reasons })
        continue
      }
      accepted.push({ title: article.title || prior.title, domain, url: finalUrl, publishedAt: article.publishedAt, sharedTerms: relevance.sharedTerms, propositions })
      acceptedFamilies.add(family)
      rechecked.push({ url: finalUrl, title: article.title || prior.title, domain, publishedAt: article.publishedAt, accepted: true })
    } catch (error) {
      rechecked.push({ url, title: prior.title, domain: prior.domain || null, reasons: [String(error?.message || error).slice(0, 180)] })
    }
  }
  return normalizeVerificationResult({ ...result, accepted, rechecked, recheckPerformed: true })
}

function markdown(report) {
  const lines = ['# Saved source-verification recheck', '', `Created: ${report.createdAt}`, '', 'No new search requests or search credits were used. Previously found URLs were fetched and reassessed using publisher-supplied dates and the corrected trusted-source policy.', '']
  for (const [index, item] of report.results.entries()) {
    lines.push(`## ${index + 1}. ${item.headline}`, '', `Status: ${item.status}`, '')
    for (const source of item.accepted || []) lines.push(`- Supporting source: [${source.domain}](${source.url})${source.publishedAt ? ` — ${source.publishedAt}` : ''}`)
    if (!(item.accepted || []).length) lines.push('- No qualifying supporting source recovered from the saved links.')
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = args(process.argv.slice(2))
  const [verification, queue] = await Promise.all([
    fs.readFile(options.verification, 'utf8').then(JSON.parse),
    fs.readFile(options.queue, 'utf8').then(JSON.parse),
  ])
  const stories = new Map((queue.withheld || []).map(story => [story.blindId, story]))
  const results = []
  for (const item of verification.results || []) {
    const story = stories.get(item.blindId)
    results.push(story ? await recheckResult(item, story) : item)
  }
  const output = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceVerification: options.verification,
    newSearches: 0, additionalSearchCostDollars: 0, results,
    statuses: Object.fromEntries([...new Set(results.map(value => value.status))].map(status => [status, results.filter(value => value.status === status).length])),
  }
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await Promise.all([
    fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8'),
    fs.writeFile(options.output.replace(/\.json$/i, '.md'), markdown(output), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ newSearches: 0, additionalSearchCostDollars: 0, statuses: output.statuses }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
