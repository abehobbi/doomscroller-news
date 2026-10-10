import fs from 'node:fs/promises'
import { assessExtractedEvidence } from './evidence-quality.mjs'
import { fetchPublicArticle } from './public-article.mjs'

function parseArgs(argv) {
  const options = { input: null, output: null, concurrency: 6 }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index]
    else if (argv[index] === '--output') options.output = argv[++index]
    else if (argv[index] === '--concurrency') options.concurrency = Number(argv[++index])
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required')
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) throw new Error('--concurrency must be an integer from 1 to 10')
  return options
}

async function fetchCandidate(selection) {
  const candidate = selection.representative
  const started = performance.now()
  try {
    const article = await fetchPublicArticle(candidate.url)
    const evidenceText = article.evidenceText
    const evidenceQuality = assessExtractedEvidence(evidenceText)
    return {
      eventClusterId: selection.id, assignedLane: selection.assignedLane,
      title: article.title || candidate.title, sourceUrl: candidate.url,
      finalUrl: article.finalUrl, publisher: candidate.domain, publishedAt: candidate.publishedAt,
      status: 'ok', httpStatus: article.httpStatus, latencyMs: Math.round(performance.now() - started),
      extractionMethod: article.extractionMethod,
      evidenceText, evidenceChars: evidenceText.length,
      evidenceQuality,
      imageUrl: article.imageUrl, imageAlt: article.imageAlt,
    }
  } catch (error) {
    return {
      eventClusterId: selection.id, assignedLane: selection.assignedLane,
      title: candidate.title, sourceUrl: candidate.url, finalUrl: null,
      publisher: candidate.domain, publishedAt: candidate.publishedAt,
      status: 'failed', httpStatus: null, latencyMs: Math.round(performance.now() - started),
      extractionMethod: null, evidenceText: '', evidenceChars: 0,
      evidenceQuality: assessExtractedEvidence(''),
      imageUrl: null, imageAlt: null,
      error: String(error?.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 240),
    }
  }
}

async function mapLimit(values, limit, fn) {
  const output = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await fn(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return output
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const edition = JSON.parse(await fs.readFile(options.input, 'utf8'))
  const items = await mapLimit(edition.selections, options.concurrency, fetchCandidate)
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: options.input,
    requested: items.length, accessible: items.filter(item => item.status === 'ok').length,
    evidenceReady: items.filter(item => item.status === 'ok' && item.evidenceChars >= 180 && item.evidenceQuality.adequate).length,
    imagesFound: items.filter(item => item.imageUrl).length,
    failures: items.filter(item => item.status === 'failed').length,
    laneCounts: Object.fromEntries([...new Set(items.map(item => item.assignedLane))].map(lane => [lane, {
      requested: items.filter(item => item.assignedLane === lane).length,
      evidenceReady: items.filter(item => item.assignedLane === lane && item.evidenceChars >= 180 && item.evidenceQuality.adequate).length,
      imagesFound: items.filter(item => item.assignedLane === lane && item.imageUrl).length,
    }])),
    items,
  }
  await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ requested: report.requested, accessible: report.accessible, evidenceReady: report.evidenceReady, imagesFound: report.imagesFound, failures: report.failures, laneCounts: report.laneCounts }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
