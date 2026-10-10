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

export function plain(value) {
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

export function extractPublicArticle(html, finalUrl) {
  const body = articleText(html)
  const description = meta(html, 'og:description') || meta(html, 'description') || ''
  const evidenceText = body.text.length >= 180 ? body.text : description
  return {
    title: meta(html, 'og:title'),
    description,
    extractionMethod: body.text.length >= 180 ? body.method : 'metadata description',
    evidenceText,
    evidenceChars: evidenceText.length,
    imageUrl: safeUrl(meta(html, 'og:image') || meta(html, 'twitter:image'), finalUrl),
    imageAlt: meta(html, 'og:image:alt'),
  }
}

export async function fetchPublicArticle(url, { timeoutMs = 20_000 } = {}) {
  const response = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Doomscroller-News-Research/1.0' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = await response.text()
  if (html.length > 4_000_000) throw new Error('response too large')
  return { httpStatus: response.status, finalUrl: response.url, ...extractPublicArticle(html, response.url) }
}
