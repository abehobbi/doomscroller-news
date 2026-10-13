import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { SOURCES } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/sources.mjs'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { publisherFamily, sourceFamilyFromEvidence } from './event-corroboration.mjs'
import { fetchPublicArticle } from './public-article.mjs'
import { trustedContextDomain } from './enrich-generation-context.mjs'
import { establishedPublisherDomain } from './selection-safeguards.mjs'

const HIGH_RISK = /\b(?:attack(?:s|ed|ing)?|kill(?:s|ed|ing)?|deaths?|died|casualt(?:y|ies)|war|military|troops?|sanctions?|elections?|protests?|corrupt(?:ion)?|crimes?|courts?|police|detain(?:s|ed|ing)?|alleg(?:es|ed|ing|ation|ations)?|accus(?:es|ed|ing|ation|ations)?|strik(?:e|es|ing)|missiles?|drones?|ceasefire|hurricanes?|earthquakes?|floods?|outbreaks?)\b/i
const MONTHS = new Map('january february march april may june july august september october november december'.split(' ').map((month, index) => [month, index]))
const REGISTERED_DOMAINS = new Set(SOURCES.map(source => {
  try { return new URL(source.sourceUrl).hostname.replace(/^www\./, '') } catch { return null }
}).filter(Boolean))

function domainOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, '') } catch { return '' }
}

export function isTrustedDomain(domain) {
  if (domain === 'aljazeera.net' || domain.endsWith('.aljazeera.net')) return true
  return trustedContextDomain(domain) || establishedPublisherDomain(domain)
    || [...REGISTERED_DOMAINS].some(value => domain === value || domain.endsWith(`.${value}`))
}

function articleUrl(member) {
  return member.url || member.snapshot?.finalUrl || member.snapshot?.sourceUrl || member.representative?.url || null
}

function publicationTime(member) {
  return member.publishedAt || member.snapshot?.publishedAt || null
}

export function evidenceMatchesTitle(title, evidence) {
  const multilingualTokens = value => new Set(String(value || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) || [])
  const headlineTerms = multilingualTokens(title)
  const evidenceTerms = multilingualTokens(String(evidence || '').slice(0, 5000))
  const sharedTerms = [...headlineTerms].filter(term => evidenceTerms.has(term))
  return { passes: sharedTerms.length >= Math.min(4, Math.max(2, Math.ceil(headlineTerms.size * 0.2))), sharedTerms }
}

export function reassessStoredSource(selection, source, context) {
  const quality = assessExtractedEvidence(source.evidenceText || '')
  const relevance = evidenceMatchesTitle(selection.representative.title, `${source.title || ''}\n${source.evidenceText || ''}`)
  const freshness = sourceFreshness({
    candidatePublishedAt: source.publishedAt, extractedPublishedAt: source.publishedAt,
    title: source.title || selection.representative.title, evidenceText: source.evidenceText,
    windowStart: context.windowStart, referenceYear: context.referenceYear,
  })
  const reasons = [...quality.reasons]
  if (!relevance.passes) reasons.push('source text does not sufficiently overlap the selected event')
  if (!freshness.fresh) reasons.push(freshness.reason)
  if (Number(source.evidenceChars || String(source.evidenceText || '').length) < 180) reasons.push('insufficient article evidence')
  return {
    ...source,
    family: sourceFamilyFromEvidence(source.domain, source.evidenceText, source.title),
    accepted: reasons.length === 0,
    trusted: isTrustedDomain(source.domain),
    reasons,
    publishedAt: freshness.publishedAt,
    eventPeriodEnd: freshness.eventPeriodEnd,
    sharedTerms: relevance.sharedTerms,
  }
}

export function explicitReportingPeriodEnd(value, referenceYear) {
  const text = String(value || '')
  const period = text.match(/reporting period[^\n]*/i)?.[0]
  if (!period) return null
  const matches = [...period.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/gi)]
  const match = matches.at(-1)
  if (!match) return null
  const month = MONTHS.get(match[2].toLowerCase())
  if (month === undefined) return null
  const explicitYear = [...matches].reverse().find(candidate => candidate[3])?.[3]
  const date = new Date(Date.UTC(Number(match[3] || explicitYear || referenceYear), month, Number(match[1]), 23, 59, 59))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function sourceFreshness({ candidatePublishedAt, extractedPublishedAt, title, evidenceText, windowStart, referenceYear }) {
  const publishedAt = extractedPublishedAt || candidatePublishedAt
  const published = Date.parse(publishedAt || '')
  const start = Date.parse(windowStart || '')
  const periodEnd = explicitReportingPeriodEnd(`${title}\n${String(evidenceText || '').slice(0, 1200)}`, referenceYear)
  if (periodEnd && Number.isFinite(start) && Date.parse(periodEnd) < start) {
    return { fresh: false, publishedAt: publishedAt || null, eventPeriodEnd: periodEnd, reason: 'explicit reporting period ended before the edition window' }
  }
  if (!Number.isFinite(published)) return { fresh: false, publishedAt: null, eventPeriodEnd: periodEnd, reason: 'no verifiable publication time' }
  if (Number.isFinite(start) && published < start - 24 * 3_600_000) return { fresh: false, publishedAt, eventPeriodEnd: periodEnd, reason: 'publication predates the edition window allowance' }
  return { fresh: true, publishedAt, eventPeriodEnd: periodEnd, reason: null }
}

function shingles(value, size = 8) {
  const words = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  return new Set(Array.from({ length: Math.max(0, words.length - size + 1) }, (_, index) => words.slice(index, index + size).join(' ')))
}

function syndicatedSimilarity(left, right) {
  const a = shingles(String(left || '').slice(0, 5000)), b = shingles(String(right || '').slice(0, 5000))
  if (!a.size || !b.size) return 0
  const shared = [...a].filter(value => b.has(value)).length
  return shared / Math.min(a.size, b.size)
}

export function independentSourceGroups(sources) {
  const groups = []
  for (const source of sources.filter(item => item.accepted)) {
    const match = groups.find(group => group.some(member => member.family === source.family || syndicatedSimilarity(member.evidenceText, source.evidenceText) >= 0.35))
    if (match) match.push(source)
    else groups.push([source])
  }
  return groups
}

async function mapLimit(values, limit, operation) {
  const output = new Array(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await operation(values[index], index)
    }
  }))
  return output
}

function uniqueMembers(selection) {
  const members = [], seenFamilies = new Set()
  for (const member of [selection.representative, ...(selection.members || [])]) {
    const url = articleUrl(member)
    if (!url) continue
    const family = publisherFamily(domainOf(url))
    if (seenFamilies.has(family)) continue
    seenFamilies.add(family)
    members.push(member)
    if (members.length >= 4) break
  }
  return members
}

export async function inspectSource(selection, member, context) {
  const url = articleUrl(member)
  const domain = domainOf(url)
  try {
    const article = await fetchPublicArticle(url, { timeoutMs: 15_000 })
    const quality = assessExtractedEvidence(article.evidenceText)
    const relevance = evidenceMatchesTitle(selection.representative.title, `${article.title || ''}\n${article.evidenceText}`)
    const freshness = sourceFreshness({
      candidatePublishedAt: publicationTime(member), extractedPublishedAt: article.publishedAt,
      title: article.title || selection.representative.title, evidenceText: article.evidenceText,
      windowStart: context.windowStart, referenceYear: context.referenceYear,
    })
    const reasons = [...quality.reasons]
    if (!relevance.passes) reasons.push('source text does not sufficiently overlap the selected event')
    if (!freshness.fresh) reasons.push(freshness.reason)
    if (article.evidenceChars < 180) reasons.push('insufficient article evidence')
    return {
      url: article.finalUrl, domain, family: sourceFamilyFromEvidence(domain, article.evidenceText, article.title), title: article.title || selection.representative.title,
      accepted: reasons.length === 0, trusted: isTrustedDomain(domain), reasons,
      publishedAt: freshness.publishedAt, eventPeriodEnd: freshness.eventPeriodEnd,
      imageUrl: article.imageUrl, imageAlt: article.imageAlt,
      evidenceChars: article.evidenceChars, extractionMethod: article.extractionMethod,
      sharedTerms: relevance.sharedTerms, evidenceText: article.evidenceText.slice(0, 6000),
    }
  } catch (error) {
    return { url, domain, family: publisherFamily(domain), accepted: false, trusted: isTrustedDomain(domain), reasons: [String(error?.message || error).slice(0, 180)] }
  }
}

export function readiness(selection, sources) {
  const accepted = sources.filter(source => source.accepted)
  const groups = independentSourceGroups(sources)
  const trustedGroups = groups.filter(group => group.some(source => source.trusted))
  const imageSource = accepted.find(source => source.imageUrl)
  const highRisk = HIGH_RISK.test(selection.representative.title)
  const reasons = []
  if (!accepted.length) reasons.push('no accessible, relevant and fresh source evidence')
  if (!trustedGroups.length) reasons.push('no trusted or registered publisher source')
  if (highRisk && trustedGroups.length < 2) reasons.push('high-risk event lacks two independent trusted source families')
  if (!imageSource) reasons.push('no verified publisher image recovered')
  return {
    ready: reasons.length === 0, reasons, highRisk,
    acceptedSourceCount: accepted.length, independentSourceFamilies: groups.length,
    trustedSourceFamilies: trustedGroups.length,
    image: imageSource ? { url: imageSource.imageUrl, alt: imageSource.imageAlt || selection.representative.title, sourceUrl: imageSource.url, publisher: imageSource.domain } : null,
  }
}

function markdown(report) {
  const lines = [
    '# Unified shortlist evidence verification', '',
    `Created: ${report.createdAt}`, '',
    `${report.ready.length} ready · ${report.repairQueue.length} need repair · ${report.rejected.length} rejected.`, '',
    'No summaries were generated and no app data was changed.', '',
  ]
  for (const [heading, items] of [['Ready', report.ready], ['Repair queue', report.repairQueue], ['Rejected', report.rejected]]) {
    lines.push(`## ${heading}`, '')
    for (const [index, item] of items.entries()) {
      lines.push(`### ${index + 1}. ${item.headline}`, '', `Lane: ${item.lane}`, '', `Source families: ${item.readiness.independentSourceFamilies}; trusted: ${item.readiness.trustedSourceFamilies}; image: ${item.readiness.image ? 'yes' : 'no'}.`, '')
      if (item.readiness.reasons.length) lines.push(`Reasons: ${item.readiness.reasons.join('; ')}.`, '')
    }
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), poolIndex = process.argv.indexOf('--pool'), outputIndex = process.argv.indexOf('--output-dir')
  if (inputIndex < 0 || poolIndex < 0 || outputIndex < 0) throw new Error('--input, --pool and --output-dir are required')
  const [shortlist, pool] = await Promise.all([
    fs.readFile(process.argv[inputIndex + 1], 'utf8').then(JSON.parse),
    fs.readFile(process.argv[poolIndex + 1], 'utf8').then(JSON.parse),
  ])
  const context = { windowStart: pool.requestedWindow?.start, referenceYear: new Date(pool.requestedWindow?.end || Date.now()).getUTCFullYear() }
  const outputDir = process.argv[outputIndex + 1]
  if (process.argv.includes('--reassess-only')) {
    const prior = JSON.parse(await fs.readFile(path.join(outputDir, 'VERIFICATION_REPORT.json'), 'utf8'))
    const inspected = [...prior.ready, ...prior.repairQueue, ...prior.rejected].map(item => {
      const selection = { representative: { title: item.headline } }
      const sources = item.sources.map(source => reassessStoredSource(selection, source, context))
      return { ...item, sources, readiness: readiness(selection, sources) }
    })
    const ready = inspected.filter(item => item.readiness.ready)
    const rejected = inspected.filter(item =>
      item.readiness.reasons.some(reason => /reporting period that ended/.test(reason)) ||
      (item.sources.length && item.sources.every(source => source.reasons?.some(reason => /predates|reporting period ended|does not sufficiently overlap/.test(reason))))
    )
    const rejectedIds = new Set(rejected.map(item => item.eventId))
    const repairQueue = inspected.filter(item => !item.readiness.ready && !rejectedIds.has(item.eventId))
    const report = { ...prior, createdAt: new Date().toISOString(), counts: { inspected: inspected.length, ready: ready.length, repair: repairQueue.length, rejected: rejected.length }, ready, repairQueue, rejected }
    await Promise.all([
      fs.writeFile(path.join(outputDir, 'VERIFICATION_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`),
      fs.writeFile(path.join(outputDir, 'VERIFICATION_REPORT.md'), markdown(report)),
    ])
    process.stdout.write(`${JSON.stringify({ reassessed: true, ...report.counts }, null, 2)}\n`)
    return
  }
  const inspected = await mapLimit(shortlist.selections, 5, async selection => {
    const sources = await mapLimit(uniqueMembers(selection), 3, member => inspectSource(selection, member, context))
    const gate = readiness(selection, sources)
    const titlePeriodEnd = explicitReportingPeriodEnd(selection.representative.title, context.referenceYear)
    if (titlePeriodEnd && Date.parse(titlePeriodEnd) < Date.parse(context.windowStart)) {
      gate.ready = false
      gate.reasons.unshift('headline explicitly identifies a reporting period that ended before the edition window')
    }
    return { eventId: selection.id, headline: selection.representative.title, lane: selection.assignedLane, selectionScore: selection.adjustedScore, titlePeriodEnd, readiness: gate, sources }
  })
  const ready = inspected.filter(item => item.readiness.ready)
  const rejected = inspected.filter(item =>
    item.readiness.reasons.some(reason => /reporting period that ended/.test(reason)) ||
    (item.sources.length && item.sources.every(source => source.reasons?.some(reason => /predates|reporting period ended|does not sufficiently overlap/.test(reason))))
  )
  const rejectedIds = new Set(rejected.map(item => item.eventId))
  const repairQueue = inspected.filter(item => !item.readiness.ready && !rejectedIds.has(item.eventId))
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceShortlist: process.argv[inputIndex + 1], sourcePool: process.argv[poolIndex + 1],
    counts: { inspected: inspected.length, ready: ready.length, repair: repairQueue.length, rejected: rejected.length },
    ready, repairQueue, rejected,
  }
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'VERIFICATION_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'VERIFICATION_REPORT.md'), markdown(report)),
  ])
  process.stdout.write(`${JSON.stringify(report.counts, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
