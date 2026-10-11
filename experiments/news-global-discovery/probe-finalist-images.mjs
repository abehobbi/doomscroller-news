import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function probe(item) {
  const started = performance.now()
  try {
    const response = await fetch(item.image.url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { Accept: 'image/*', Range: 'bytes=0-8191', 'User-Agent': 'Doomscroller-News-Research/1.0' } })
    const contentType = response.headers.get('content-type') || ''
    const valid = response.ok && contentType.toLowerCase().startsWith('image/')
    if (response.body) await response.body.cancel()
    return { eventId: item.eventId, rank: item.rank, headline: item.headline, url: item.image.url, finalUrl: response.url, httpStatus: response.status, contentType, latencyMs: Math.round(performance.now() - started), valid, reason: valid ? null : `HTTP ${response.status}; content type ${contentType || 'missing'}` }
  } catch (error) {
    return { eventId: item.eventId, rank: item.rank, headline: item.headline, url: item.image.url, latencyMs: Math.round(performance.now() - started), valid: false, reason: String(error?.message || error).slice(0, 180) }
  }
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output are required')
  const input = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const results = []
  for (const item of input.ready || []) results.push(await probe(item))
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), candidateCount: results.length, passed: results.filter(value => value.valid), failed: results.filter(value => !value.valid), results }
  const output = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ candidateCount: report.candidateCount, passed: report.passed.length, failed: report.failed.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
