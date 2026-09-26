// Enabled only in the isolated News v1.1 development branch. Main remains off.
// Set false to pause without removing any Stage 1 implementation.
export const NEWS_ENABLED = true

// The automatic-summary beta is opt-in at build time. Stage 1 remains the
// default data path and can be restored remotely through beta-control.json.
export const NEWS_BETA_BUILD = import.meta.env?.VITE_NEWS_BETA_ENABLED === 'true'
export const NEWS_STAGE1_DATA_URL = import.meta.env?.VITE_NEWS_DATA_URL || '/news/feed.json'
export const NEWS_BETA_DATA_URL = import.meta.env?.VITE_NEWS_BETA_DATA_URL || '/news/beta-feed.json'
export const NEWS_BETA_CONTROL_URL = import.meta.env?.VITE_NEWS_BETA_CONTROL_URL || '/news/beta-control.json'

export function releaseCategories(categories, newsEnabled = NEWS_ENABLED) {
  const selected = Array.isArray(categories) ? categories : ['definitions']
  const enabled = newsEnabled ? selected : selected.filter(id => id !== 'news')
  return enabled.length ? enabled : ['definitions']
}

export function savedQueueContainsPausedNews(queue, newsEnabled = NEWS_ENABLED) {
  return !newsEnabled && Array.isArray(queue) && queue.some(slide => slide?.type === 'news')
}
