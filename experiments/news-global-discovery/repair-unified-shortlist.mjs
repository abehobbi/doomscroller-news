import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { publisherFamily, sourceFamilyFromEvidence } from './event-corroboration.mjs'
import { inspectSource, readiness, reassessStoredSource } from './verify-unified-shortlist.mjs'

const API_URL = 'https://api.exa.ai/search'
const EXCLUDED_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'x.com']

function parseArgs(argv) {
  const options = { input: null, pool: null, outputDir: null, maximum: 12, dryRun: false, reassessOnly: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index]
    else if (argv[index] === '--pool') options.pool = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
    else if (argv[index] === '--maximum') options.maximum = Number(argv[++index])
    else if (argv[index] === '--dry-run') options.dryRun = true
    else if (argv[index] === '--reassess-only') options.reassessOnly = true
  }
  if (!options.input || !options.pool || !options.outputDir) throw new Error('--input, --pool and --output-dir are required')
  if (!Number.isInteger(options.maximum) || options.maximum < 1 || options.maximum > 20) throw new Error('--maximum must be from 1 to 20')
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

export function repairCandidates(report, maximum = 12) {
  return [...report.repairQueue]
    .filter(item => !item.readiness.reasons.some(reason => /reporting period that ended/.test(reason)))
    .sort((left, right) => Number(right.selectionScore || 0) - Number(left.selectionScore || 0))
    .slice(0, maximum)
}

async function search(apiKey, item) {
  const evidence = item.sources.find(source => source.evidenceText)?.evidenceText?.slice(0, 900) || ''
  const body = {
    query: `${item.headline} ${evidence}`,
    objective: repairObjective(item),
    type: 'auto', numResults: 6, moderation: true, excludeDomains: EXCLUDED_DOMAINS,
  }
  const started = performance.now()
  const response = await fetch(API_URL, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await response.text()
  let payload = null
  try { payload = JSON.parse(raw) } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.error || raw.slice(0, 180)}`)
  return { results: payload?.results || [], requestId: payload?.requestId || null, costDollars: Number(payload?.costDollars?.total || 0), latencyMs: Math.round(performance.now() - started) }
}

export function repairObjective(item) {
  const reasons = item.readiness?.reasons || []
  if (reasons.length === 1 && reasons[0] === 'no verified publisher image recovered') return 'Find an original reputable publisher article about this exact event that contains a usable event-specific article image. Prefer the publisher page or a genuinely independent report, not homepages, logos, author portraits, generic stock imagery or copied syndications. Preserve a clear publication date.'
  if (reasons.some(reason => /two independent trusted source families/i.test(reason))) return 'Find genuinely independent reputable reporting about this exact high-risk event, preferably from a different publisher family or a primary institutional record. Do not return copied wire republications, homepages or generic background. Require a clear publication date and prefer a usable event-specific article image.'
  if (reasons.some(reason => /no accessible|no trusted|insufficient article evidence/i.test(reason))) return 'Find the original accessible report or a reputable direct report about this exact event with substantial article text, a clear publication date and a usable event-specific image. Avoid homepages, snippets, copied syndications and generic background.'
  return 'Find independent, reputable reporting or a primary institutional record about this exact event. Prefer a different publisher family from the supplied report. Return original article pages with a clear publication date and usable article image; avoid homepages, copied syndications and generic background.'
}

export function mergeSources(existing, additions) {
  const output = [], seen = new Set()
  for (const source of [...existing, ...additions]) {
    const family = sourceFamilyFromEvidence(source.domain, source.evidenceText, source.title)
    const key = `${family}|${canonicalUrl(source.url)}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({ ...source, family })
  }
  return output
}

export function pendingRepairCandidates(candidates, savedResults = []) {
  const completed = new Set(savedResults.map(item => item.eventId))
  return candidates.filter(item => !completed.has(item.eventId))
}

async function repairItem(apiKey, item, context) {
  const found = await search(apiKey, item)
  const selection = { representative: { title: item.headline } }
  const existingUrls = new Set(item.sources.map(source => canonicalUrl(source.url)))
  const existingFamilies = new Set(item.sources.map(source => sourceFamilyFromEvidence(source.domain, source.evidenceText, source.title)))
  const inspected = []
  for (const result of found.results) {
    const url = canonicalUrl(result.url)
    if (!url || existingUrls.has(url)) continue
    const source = await inspectSource(selection, { url, publishedAt: result.publishedDate }, context)
    if (existingFamilies.has(source.family) || inspected.some(value => value.family === source.family)) continue
    inspected.push(source)
  }
  const sources = mergeSources(item.sources, inspected)
  const gate = readiness(selection, sources)
  return {
    ...item, readiness: gate, sources,
    repair: {
      requestId: found.requestId, costDollars: found.costDollars, latencyMs: found.latencyMs,
      candidatesInspected: inspected.length, acceptedAdditions: inspected.filter(source => source.accepted).length,
    },
  }
}

function markdown(output) {
  const lines = [
    '# Bounded unified shortlist source repair', '',
    `Created: ${output.createdAt}`, '',
    `${output.searches} searches · $${output.costDollars.toFixed(3)} reported Exa cost · ${output.repaired} stories repaired · ${output.unresolved} still unresolved.`, '',
    'No summaries were generated and no app data was changed.', '',
  ]
  output.results.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.headline}`, '', `Status: ${item.readiness.ready ? 'repaired' : 'still unresolved'}`, '')
    lines.push(`Independent source families: ${item.readiness.independentSourceFamilies}; trusted families: ${item.readiness.trustedSourceFamilies}; image: ${item.readiness.image ? 'yes' : 'no'}.`, '')
    if (item.readiness.reasons.length) lines.push(`Remaining blockers: ${item.readiness.reasons.join('; ')}.`, '')
    const additions = item.sources.slice(item.originalSourceCount)
    additions.filter(source => source.accepted).forEach(source => lines.push(`- Added: [${source.domain}](${source.url})`))
    if (!additions.some(source => source.accepted)) lines.push('- No acceptable new source was found in this bounded search.')
    lines.push('')
  })
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [report, pool] = await Promise.all([
    fs.readFile(options.input, 'utf8').then(JSON.parse),
    fs.readFile(options.pool, 'utf8').then(JSON.parse),
  ])
  const candidates = repairCandidates(report, options.maximum)
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ candidates: candidates.length, estimatedCostDollarsAtObservedRate: Number((candidates.length * 0.007).toFixed(3)), headlines: candidates.map(item => item.headline) }, null, 2)}\n`)
    return
  }
  const outputPath = path.join(options.outputDir, 'SOURCE_REPAIR_REPORT.json')
  const context = { windowStart: pool.requestedWindow?.start, referenceYear: new Date(pool.requestedWindow?.end || Date.now()).getUTCFullYear() }
  if (options.reassessOnly) {
    const prior = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    const results = prior.results.map(item => {
      const selection = { representative: { title: item.headline } }
      const sources = item.sources.map(source => reassessStoredSource(selection, source, context))
      return { ...item, sources, readiness: readiness(selection, sources) }
    })
    const output = {
      ...prior, createdAt: new Date().toISOString(),
      repaired: results.filter(item => item.readiness.ready).length,
      unresolved: results.filter(item => !item.readiness.ready).length,
      results,
    }
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
    await fs.writeFile(path.join(options.outputDir, 'SOURCE_REPAIR_REPORT.md'), markdown(output))
    process.stdout.write(`${JSON.stringify({ searches: 0, addedCostDollars: 0, repaired: output.repaired, unresolved: output.unresolved }, null, 2)}\n`)
    return
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
  await fs.mkdir(options.outputDir, { recursive: true })
  let results = []
  try {
    const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    if (saved.sourceReport === options.input && Array.isArray(saved.results)) results = saved.results
  } catch {}
  const writeCheckpoint = async complete => {
    const checkpoint = {
      schemaVersion: 1, createdAt: new Date().toISOString(), sourceReport: options.input, complete,
      searches: results.filter(item => item.repair?.requestId).length,
      costDollars: Number(results.reduce((sum, item) => sum + Number(item.repair?.costDollars || 0), 0).toFixed(6)),
      repaired: results.filter(item => item.readiness.ready).length,
      unresolved: results.filter(item => !item.readiness.ready).length,
      completedCandidates: results.length, totalCandidates: candidates.length, results,
    }
    await fs.writeFile(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
    return checkpoint
  }
  for (const candidate of pendingRepairCandidates(candidates, results)) {
    const originalSourceCount = candidate.sources.length
    try {
      results.push({ ...(await repairItem(apiKey, candidate, context)), originalSourceCount })
    } catch (error) {
      results.push({ ...candidate, originalSourceCount, repair: { requestId: null, costDollars: 0, latencyMs: 0, candidatesInspected: 0, acceptedAdditions: 0, error: String(error?.message || error).slice(0, 240) } })
    }
    await writeCheckpoint(false)
  }
  const output = await writeCheckpoint(true)
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'SOURCE_REPAIR_REPORT.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ searches: output.searches, costDollars: output.costDollars, repaired: output.repaired, unresolved: output.unresolved }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
