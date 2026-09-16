export const ACTIVE_HOURS = 5 * 24
export const RETENTION_HOURS = 14 * 24
export const MAX_FEED_ARTICLES = 120
export const MAX_RETAINED_ARTICLES = 500
export const MAX_PER_PUBLISHER = 32

export function applyFreshness(articles, now = new Date()) {
  const nowMs = now.getTime()
  const retained = articles
    .filter(article => {
      const ageHours = (nowMs - Date.parse(article.publishedAt)) / 3_600_000
      return ageHours >= -12 && ageHours <= RETENTION_HOURS
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_RETAINED_ARTICLES)

  const sourceCounts = new Map()
  const active = []
  for (const article of retained) {
    const ageHours = (nowMs - Date.parse(article.publishedAt)) / 3_600_000
    if (ageHours > ACTIVE_HOURS) continue
    const count = sourceCounts.get(article.sourceId) || 0
    if (count >= MAX_PER_PUBLISHER) continue
    sourceCounts.set(article.sourceId, count + 1)
    active.push(article.id)
    if (active.length >= MAX_FEED_ARTICLES) break
  }

  return { retained, activeArticleIds: active }
}

