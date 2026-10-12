import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchPublicArticle } from './public-article.mjs'

async function liveImage(url) {
  if (!url) return { valid: false, reason: 'publisher page exposes no distinct image URL' }
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { Accept: 'image/*', Range: 'bytes=0-8191', 'User-Agent': 'Doomscroller-News-Research/1.0' } })
    const contentType = response.headers.get('content-type') || ''
    const valid = response.ok && contentType.toLowerCase().startsWith('image/')
    if (response.body) await response.body.cancel()
    return { valid, url, finalUrl: response.url, httpStatus: response.status, contentType, reason: valid ? null : `HTTP ${response.status}; content type ${contentType || 'missing'}` }
  } catch (error) { return { valid: false, url, reason: String(error?.message || error).slice(0, 180) } }
}

async function visibleImageCandidates(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/html', 'User-Agent': 'Doomscroller-News-Research/1.0' } })
  if (!response.ok) return []
  const html = await response.text()
  const values = [...html.matchAll(/<img\b[^>]+(?:src|data-src|data-original)=["']([^"']+)["']/gi)].map(match => match[1])
  const candidates = []
  for (const value of values) {
    try {
      const candidate = new URL(value, response.url)
      if (candidate.protocol !== 'https:' || /(?:logo|icon|avatar|sprite|pixel|tracking|badge|favicon|\.svg(?:\?|$))/i.test(candidate.pathname)) continue
      if (!candidates.includes(candidate.href)) candidates.push(candidate.href)
    } catch {}
  }
  return candidates.slice(0, 12)
}

async function repair(item) {
  try {
    const article = await fetchPublicArticle(item.primarySource.url)
    const direct = await liveImage(article.imageUrl)
    if (direct.valid) return { eventId: item.eventId, rank: item.rank, headline: item.headline, articleUrl: article.finalUrl, image: direct }
    const candidates = await visibleImageCandidates(article.finalUrl)
    for (const candidate of candidates) {
      const checked = await liveImage(candidate)
      if (checked.valid) return { eventId: item.eventId, rank: item.rank, headline: item.headline, articleUrl: article.finalUrl, image: checked, recoveredFrom: 'visible article image' }
    }
    return { eventId: item.eventId, rank: item.rank, headline: item.headline, articleUrl: article.finalUrl, image: direct, visibleCandidatesChecked: candidates.length }
  } catch (error) {
    return { eventId: item.eventId, rank: item.rank, headline: item.headline, articleUrl: item.primarySource.url, image: { valid: false, reason: String(error?.message || error).slice(0, 180) } }
  }
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output are required')
  const input = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const results = []
  for (const item of input.imageRepair || []) results.push(await repair(item))
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), repaired: results.filter(value => value.image.valid), unresolved: results.filter(value => !value.image.valid), results }
  const outputPath = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ candidates: results.length, repaired: output.repaired.length, unresolved: output.unresolved.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
