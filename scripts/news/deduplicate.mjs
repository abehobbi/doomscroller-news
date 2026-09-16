import { canonicalizeUrl } from './normalize.mjs'

export function headlineFingerprint(value) {
  return String(value || '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[|–—-]\s*(bbc|cbc|npr|the guardian|al jazeera)( news)?\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function deduplicateArticles(articles) {
  const ordered = [...articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const seenIds = new Set()
  const seenUrls = new Set()
  const seenHeadlines = new Set()
  const kept = []

  for (const article of ordered) {
    const urlKey = canonicalizeUrl(article.url)
    const headlineKey = headlineFingerprint(article.title)
    if (seenIds.has(article.id) || (urlKey && seenUrls.has(urlKey)) || (headlineKey && seenHeadlines.has(headlineKey))) continue
    seenIds.add(article.id)
    if (urlKey) seenUrls.add(urlKey)
    if (headlineKey) seenHeadlines.add(headlineKey)
    kept.push(article)
  }
  return kept
}

