import { compareEvents, detectWireOrigin } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

const STOP = new Set('about after against amid among around because before being between could from have into more over says said than that their there these they this through under were what when where which while will with would'.split(' '))
const HIGH_RISK = /\b(?:killed|dead|death|casualt|alleged|accused|war crime|abuse|attack|strike|explosion|outbreak|corruption|fraud|detained|arrested)\b/i
const ATTRIBUTION = /\b(?:according to|said|reported|officials?|authorities|police|ministry|statement|court|researchers?|study|data|agency)\b/i

function stem(value) {
  return value.replace(/(?:ies)$/i, 'y').replace(/(?:ing|ed|es|s)$/i, '')
}

export function lexicalTokens(value) {
  return new Set(String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => token.length > 3 && !STOP.has(token)).map(stem))
}

function overlap(left, right) {
  const a = lexicalTokens(left), b = lexicalTokens(right)
  const shared = [...a].filter(token => b.has(token)).length
  return { shared, containment: shared / Math.max(1, Math.min(a.size, b.size)), jaccard: shared / Math.max(1, new Set([...a, ...b]).size) }
}

function distinctiveOverlap(left, right) {
  const pick = value => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => /\d/.test(token) || token.length >= 8).map(stem))
  const a = pick(left), b = pick(right)
  return [...a].filter(token => b.has(token)).length
}

function headlineAcronyms(value) {
  const ignored = new Set(['US', 'UK', 'UN', 'EU', 'UAE'])
  return new Set([...String(value || '').matchAll(/\b[A-Z]{2,}\b/g)].map(match => match[0]).filter(value => !ignored.has(value)))
}

function article(item) {
  return {
    id: item.selection.id,
    title: item.snapshot.title || item.selection.representative.title,
    description: item.snapshot.evidenceText.slice(0, 1800),
    url: item.snapshot.finalUrl || item.snapshot.sourceUrl,
    publishedAt: item.snapshot.publishedAt || item.selection.representative.publishedAt,
  }
}

export function compareCandidateEvents(left, right) {
  const deterministic = compareEvents(article(left), article(right))
  if (deterministic.reason === 'explicit event locations conflict') return deterministic
  const leftAcronyms = headlineAcronyms(article(left).title), rightAcronyms = headlineAcronyms(article(right).title)
  if (leftAcronyms.size && rightAcronyms.size && ![...leftAcronyms].some(value => rightAcronyms.has(value))) {
    return { relation: 'distinct-or-uncertain', score: 0, reason: 'conflicting named organizations in headlines' }
  }
  if (deterministic.relation !== 'distinct-or-uncertain') return deterministic
  const titles = overlap(article(left).title, article(right).title)
  const leads = overlap(article(left).description.slice(0, 900), article(right).description.slice(0, 900))
  const distinctive = distinctiveOverlap(`${article(left).title} ${article(left).description.slice(0, 1500)}`, `${article(right).title} ${article(right).description.slice(0, 1500)}`)
  if (titles.shared >= 4 && titles.containment >= 0.66) return { relation: 'same-event', score: Math.round(titles.containment * 20), reason: `strong normalized headline overlap (${titles.shared} terms, ${titles.containment.toFixed(2)} containment)` }
  if (titles.shared >= 3 && titles.containment >= 0.45 && leads.shared >= 8 && leads.jaccard >= 0.22) return { relation: 'same-event', score: Math.round((titles.containment + leads.jaccard) * 15), reason: 'headline and lead evidence independently overlap' }
  if (titles.shared >= 2 && distinctive >= 3 && leads.shared >= 7 && leads.containment >= 0.18) return { relation: 'same-event', score: distinctive * 3 + titles.shared + Math.round(leads.containment * 10), reason: `shared distinctive entities/details (${distinctive}) plus overlapping evidence` }
  if (titles.shared >= 2 && distinctive >= 5 && leads.shared >= 10) return { relation: 'same-event', score: distinctive * 3 + titles.shared, reason: `shared named scientific/event details (${distinctive}) across differently written reports` }
  return deterministic
}

function normalizedPublisher(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '').replace(/^edition\./, '')
}

export function sourceFamily(item) {
  const evidence = item.snapshot.evidenceText || ''
  const detected = detectWireOrigin(evidence) || evidence.slice(0, 1200).match(/\b(?:Reuters|Associated Press|Canadian Press|Agence France-Presse|AFP)\b|\(AP\)/i)?.[0]
  if (detected) return `wire:${detected.toLowerCase().replace('(ap)', 'ap').replace('associated press', 'ap').replace('canadian press', 'cp').replace('agence france-presse', 'afp')}`
  const publisher = normalizedPublisher(item.snapshot.publisher)
  if (publisher === 'bbc.co.uk') return 'publisher:bbc.com'
  return `publisher:${publisher}`
}

export function clusterCorroboratedEvents(items) {
  const clusters = []
  for (const item of items) {
    let best = null
    for (const cluster of clusters) for (const member of cluster.members) {
      const comparison = compareCandidateEvents(item, member)
      if (comparison.relation !== 'distinct-or-uncertain' && (!best || comparison.score > best.comparison.score)) best = { cluster, member, comparison }
    }
    if (best) {
      best.cluster.members.push(item)
      best.cluster.relations.push({ left: item.selection.id, right: best.member.selection.id, ...best.comparison })
    } else clusters.push({ members: [item], relations: [] })
  }
  return clusters.map((cluster, index) => {
    const families = [...new Set(cluster.members.map(sourceFamily))]
    const publishers = [...new Set(cluster.members.map(member => normalizedPublisher(member.snapshot.publisher)))]
    const representative = [...cluster.members].sort((a, b) => {
      const sourceBonus = family => /^(?:publisher:(?:reuters\.com|apnews\.com|bbc\.com|cbc\.ca|aljazeera\.com|theguardian\.com|nature\.com))$/.test(family) ? 1 : 0
      const pool = value => Number(value.selection.poolScore ?? value.selection.adjustedScore ?? 0)
      return pool(b) - pool(a) || sourceBonus(sourceFamily(b)) - sourceBonus(sourceFamily(a)) || b.snapshot.evidenceChars - a.snapshot.evidenceChars || Date.parse(b.snapshot.publishedAt || '') - Date.parse(a.snapshot.publishedAt || '')
    })[0]
    const combined = cluster.members.map(member => `${member.snapshot.title} ${member.snapshot.evidenceText.slice(0, 1500)}`).join(' ')
    const highRisk = HIGH_RISK.test(combined)
    const attributed = ATTRIBUTION.test(combined)
    return {
      id: `qualified-event-${String(index + 1).padStart(3, '0')}`,
      ...cluster, representative,
      lanes: [...new Set(cluster.members.map(member => member.selection.assignedLane))],
      sourceFamilies: families, publishers,
      independentSourceCount: families.length,
      corroborationStatus: families.length >= 2 ? 'multi-source' : highRisk ? (attributed ? 'single-source-attributed' : 'single-source-unattributed') : 'single-source',
      highRisk,
    }
  })
}
