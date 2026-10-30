import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MINIMUM_CARDS = 30
const MAXIMUM_CARDS = 65
const cleanUrl = value => { try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null } }
const iso = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null }

function sourceFor(source, publishedAt, index) {
  const url = cleanUrl(source?.url), name = String(source?.publisher || source?.name || '').trim()
  return url && name ? { name, url, role: index === 0 ? 'primary' : 'additional', publishedAt: iso(source?.publishedAt) || publishedAt, updatedAt: iso(source?.updatedAt) } : null
}

function cardFor(card, generatedAt) {
  const eventId = String(card?.eventId || '').trim(), headline = String(card?.headline || '').replace(/\s+/g, ' ').trim(), publishedAt = iso(card?.publishedAt)
  const pages = Array.isArray(card?.pages) ? card.pages.map(page => ({ text: String(page?.text || '').trim() })).filter(page => page.text).slice(0, 3) : []
  const orderedSources = Array.isArray(card?.sources) ? [...card.sources] : []
  const primaryIndex = orderedSources.findIndex(source => cleanUrl(source?.url) === cleanUrl(card?.primaryUrl))
  if (primaryIndex > 0) orderedSources.unshift(...orderedSources.splice(primaryIndex, 1))
  const sources = orderedSources.map((source, index) => sourceFor(source, publishedAt, index)).filter(Boolean)
  if (!/^event:[a-z0-9._:-]{5,153}$/i.test(eventId)) throw new Error(`Invalid event id: ${eventId || '(missing)'}`)
  if (headline.length < 12 || !publishedAt || !pages.length || !sources.length) throw new Error(`Incomplete release card: ${eventId}`)
  const imageUrl = cleanUrl(card?.image?.url)
  return {
    event_id: eventId, headline, pages,
    uncertainties: Array.isArray(card?.uncertainties) ? card.uncertainties.map(String).filter(Boolean).slice(0, 12) : [],
    image: {
      url: imageUrl, alt: imageUrl ? String(card?.image?.alt || headline).trim() : null,
      status: imageUrl ? 'event-specific' : 'unresolved', source_url: cleanUrl(card?.image?.sourceUrl || card?.primaryUrl),
      attribution: imageUrl ? String(card?.image?.publisher || sources[0].name).trim() : null,
      rights_basis: imageUrl ? 'Publisher-hosted remote reference; no image bytes are copied and no reuse rights are asserted.' : 'Approved high-value no-image exception.',
    },
    sources, geography: Array.isArray(card?.priorityRegions) ? [...new Set(card.priorityRegions.map(String).filter(Boolean))] : [],
    topics: [String(card?.lane || 'world-interesting')], first_seen: generatedAt, updated_at: generatedAt, generated_at: generatedAt,
    evidence_fingerprint: `daily:${eventId}:${publishedAt}`, content_version: 1,
    editorial_lane: String(card?.lane || 'world-interesting'), front_page_rank: Number(card?.frontPageRank) || null,
  }
}

export function buildReleaseDataset(edition, readiness, { releaseAuthorized = false } = {}) {
  if (!releaseAuthorized) throw new Error('Release lock is active')
  if (!edition || edition.schemaVersion !== 1 || edition.shadowOnly !== true || !Array.isArray(edition.cards)) throw new Error('Unsupported shadow edition')
  if (!readiness?.strongDailySuccess || !Object.values(readiness?.checks || {}).every(Boolean)) throw new Error('Daily readiness did not pass every strong-success check')
  if (edition.cards.length < MINIMUM_CARDS || edition.cards.length > MAXIMUM_CARDS) throw new Error(`Edition has ${edition.cards.length} cards; expected ${MINIMUM_CARDS}-${MAXIMUM_CARDS}`)
  const generatedAt = iso(edition.createdAt)
  if (!generatedAt) throw new Error('Edition has no valid creation time')
  const cards = edition.cards.map(card => cardFor(card, generatedAt)), ids = cards.map(card => card.event_id)
  if (new Set(ids).size !== ids.length) throw new Error('Edition contains duplicate event ids')
  return {
    schema: 'doomscroller.news-beta-dataset', schemaVersion: 1, generatedAt,
    batchId: `news-daily-${generatedAt.replace(/[:.]/g, '-')}`, feed: { eventIds: ids }, cards,
    policy: { source: 'five-lane-daily-edition', minimumCards: MINIMUM_CARDS, maximumCards: MAXIMUM_CARDS, strongDailySuccess: true },
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const input = value('--input'), readinessPath = value('--readiness'), output = value('--output'), controlPath = value('--control')
  if (!input || !readinessPath || !output) throw new Error('--input, --readiness and --output are required')
  const [edition, readiness] = await Promise.all([input, readinessPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const dataset = buildReleaseDataset(edition, readiness, { releaseAuthorized: args.includes('--release-authorized') })
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`)
  if (controlPath) {
    const control = { schema: 'doomscroller.news-beta-control', schemaVersion: 1, enabled: true, datasetUrl: 'beta-feed.json', fallbackUrl: 'feed.json', updatedAt: dataset.generatedAt }
    await fs.mkdir(path.dirname(path.resolve(controlPath)), { recursive: true })
    await fs.writeFile(controlPath, `${JSON.stringify(control, null, 2)}\n`)
  }
  process.stdout.write(`${JSON.stringify({ cards: dataset.cards.length, generatedAt: dataset.generatedAt }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
