// Enabled only in the isolated News v1.1 development branch. Main remains off.
// Set false to pause without removing any Stage 1 implementation.
export const NEWS_ENABLED = true

export function releaseCategories(categories, newsEnabled = NEWS_ENABLED) {
  const selected = Array.isArray(categories) ? categories : ['definitions']
  const enabled = newsEnabled ? selected : selected.filter(id => id !== 'news')
  return enabled.length ? enabled : ['definitions']
}

export function savedQueueContainsPausedNews(queue, newsEnabled = NEWS_ENABLED) {
  return !newsEnabled && Array.isArray(queue) && queue.some(slide => slide?.type === 'news')
}
