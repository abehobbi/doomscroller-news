const TORONTO_ZONE = 'America/Toronto'

function torontoParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}

export function dueEdition(date = new Date()) {
  const parts = torontoParts(date)
  const minute = Number(parts.minute)
  if (![30, 45].includes(minute)) return null
  if (parts.hour === '08') return { slot: 'morning', date: `${parts.year}-${parts.month}-${parts.day}`, scan: 'full', windowHours: '24' }
  if (parts.hour === '20') return { slot: 'evening', date: `${parts.year}-${parts.month}-${parts.day}`, scan: 'major', windowHours: '12' }
  return null
}

export function editionAlreadyPublished(generatedAt, due) {
  const generated = new Date(generatedAt || '')
  if (!Number.isFinite(generated.getTime())) return false
  const parts = torontoParts(generated)
  if (`${parts.year}-${parts.month}-${parts.day}` !== due.date) return false
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  return minutes >= (due.slot === 'morning' ? 8 * 60 : 20 * 60)
}

async function currentEdition(env) {
  const response = await fetch(`https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPOSITORY}/main/public/news/beta-feed.json`, {
    headers: { 'user-agent': 'doomscroller-news-scheduler' },
  })
  if (!response.ok) return null
  return response.json()
}

async function dispatch(due, env) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPOSITORY}/actions/workflows/update-news.yml/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.NEWS_GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'doomscroller-news-scheduler',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: { scan: due.scan, window_hours: due.windowHours, publish_dataset: 'true', external_clock: 'true' },
    }),
  })
  if (!response.ok) throw new Error(`GitHub dispatch failed with HTTP ${response.status}`)
}

export async function runScheduled(date, env) {
  const due = dueEdition(date)
  if (!due) return { action: 'idle', reason: 'No Toronto edition is due.' }
  if (!env.NEWS_GITHUB_TOKEN) throw new Error('NEWS_GITHUB_TOKEN is missing')
  const feed = await currentEdition(env).catch(() => null)
  if (editionAlreadyPublished(feed?.generatedAt, due)) return { action: 'idle', reason: `${due.slot} edition is already published.` }
  await dispatch(due, env)
  return { action: 'dispatched', slot: due.slot, attempt: Number(torontoParts(date).minute) === 30 ? 'primary' : 'retry' }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(new Date(controller.scheduledTime), env).then(result => console.log(JSON.stringify(result))))
  },
  async fetch() {
    return new Response('Doomscroller News scheduler is active.', { status: 200 })
  },
}
