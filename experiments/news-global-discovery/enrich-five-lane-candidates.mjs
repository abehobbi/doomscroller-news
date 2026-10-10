import fs from 'node:fs/promises'

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

function decode(value) {
  const named = { amp: '&', apos: "'", quot: '"', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, key) => {
    if (key.startsWith('#')) {
      const hex = key[1]?.toLowerCase() === 'x'
      const number = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(number) ? String.fromCodePoint(number) : match
    }
    return named[key.toLowerCase()] ?? match
  })
}

function plain(value) {
  return decode(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  const match = String(html || '').match(expression)
  return plain(match?.[1] || match?.[2] || '') || null
}

function jsonLd(html) {
  const found = []
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = value => {
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') {
          if (typeof value.articleBody === 'string') found.push(value.articleBody)
          Object.values(value).forEach(visit)
        }
      }
      visit(JSON.parse(match[1]))
    } catch { /* Ignore malformed publisher metadata. */ }
  }
  return found.map(plain).filter(value => value.length >= 180).sort((a, b) => b.length - a.length)[0] || null
}

function articleText(html) {
  const structured = jsonLd(html)
  if (structured) return { method: 'JSON-LD articleBody', text: structured.slice(0, 20_000) }
  const paragraphs = [...String(html || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => plain(match[1]))
    .filter(value => value.length >= 45 && !/cookie|newsletter|sign up|advertisement|all rights reserved/i.test(value))
  return { method: 'public HTML paragraphs', text: paragraphs.join(' ').slice(0, 20_000) }
}

function safeUrl(value, base) {
  try {
    const url = new URL(decode(value), base)
    return url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

async function fetchCandidate(selection) {
  const candidate = selection.representative
  const started = performance.now()
  try {
    const response = await fetch(candidate.url, {
      redirect: 'follow', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Doomscroller-News-Research/1.0' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    if (html.length > 4_000_000) throw new Error('response too large')
    const body = articleText(html)
    const description = meta(html, 'og:description') || meta(html, 'description') || ''
    const evidenceText = body.text.length >= 180 ? body.text : description
    const imageUrl = safeUrl(meta(html, 'og:image') || meta(html, 'twitter:image'), response.url)
    return {
      eventClusterId: selection.id, assignedLane: selection.assignedLane,
      title: meta(html, 'og:title') || candidate.title, sourceUrl: candidate.url,
      finalUrl: response.url, publisher: candidate.domain, publishedAt: candidate.publishedAt,
      status: 'ok', httpStatus: response.status, latencyMs: Math.round(performance.now() - started),
      extractionMethod: body.text.length >= 180 ? body.method : 'metadata description',
      evidenceText, evidenceChars: evidenceText.length,
      imageUrl, imageAlt: meta(html, 'og:image:alt'),
    }
  } catch (error) {
    return {
      eventClusterId: selection.id, assignedLane: selection.assignedLane,
      title: candidate.title, sourceUrl: candidate.url, finalUrl: null,
      publisher: candidate.domain, publishedAt: candidate.publishedAt,
      status: 'failed', httpStatus: null, latencyMs: Math.round(performance.now() - started),
      extractionMethod: null, evidenceText: '', evidenceChars: 0,
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
    evidenceReady: items.filter(item => item.status === 'ok' && item.evidenceChars >= 180).length,
    imagesFound: items.filter(item => item.imageUrl).length,
    failures: items.filter(item => item.status === 'failed').length,
    laneCounts: Object.fromEntries([...new Set(items.map(item => item.assignedLane))].map(lane => [lane, {
      requested: items.filter(item => item.assignedLane === lane).length,
      evidenceReady: items.filter(item => item.assignedLane === lane && item.evidenceChars >= 180).length,
      imagesFound: items.filter(item => item.assignedLane === lane && item.imageUrl).length,
    }])),
    items,
  }
  await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ requested: report.requested, accessible: report.accessible, evidenceReady: report.evidenceReady, imagesFound: report.imagesFound, failures: report.failures, laneCounts: report.laneCounts }, null, 2)}\n`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
