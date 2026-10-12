import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const STOP = new Set('about after against amid among around because before being between could from have into more over says said than that their there these they this through under were what when where which while will with would latest statement'.split(' '))
const PLACE = new Set(['riyadh', 'saudi', 'syria', 'gaza', 'ukraine', 'bangladesh', 'ghana', 'canada', 'nepal', 'sudan', 'india'])
const EVENT = new Set(['airport', 'attack', 'strike', 'sanction', 'court', 'ceasefire', 'flood', 'protest', 'election', 'outbreak'])
const ENTITY_ALIASES = new Map([
  ['international-criminal-court', [/\binternational criminal court\b/i, /\bICC\b/]],
  ['international-monetary-fund', [/\binternational monetary fund\b/i, /\bIMF\b/]],
  ['world-health-organization', [/\bworld health organi[sz]ation\b/i, /\bWHO\b/]],
  ['international-atomic-energy-agency', [/\binternational atomic energy agency\b/i, /\bIAEA\b/]],
  ['north-atlantic-treaty-organization', [/\bnorth atlantic treaty organi[sz]ation\b/i, /\bNATO\b/]],
])

function words(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => token.length >= 4 && !STOP.has(token)).map(token => token.replace(/(?:ies|ing|ed|es|s)$/i, '')))
}

function acronyms(value) {
  return new Set([...String(value || '').matchAll(/\b[A-Z]{2,}\b/g)].map(match => match[0]).filter(value => !['US', 'UK', 'UN', 'EU', 'UAE'].includes(value)))
}

function namedEntities(value) {
  return new Set([...ENTITY_ALIASES].filter(([, patterns]) => patterns.some(pattern => pattern.test(String(value || '')))).map(([entity]) => entity))
}

export function possibleThreadOverlap(left, right) {
  const a = words(left), b = words(right), shared = [...a].filter(token => b.has(token))
  const aa = acronyms(left), ab = acronyms(right)
  const ea = namedEntities(left), eb = namedEntities(right)
  if ([...ea].some(value => eb.has(value))) return true
  if ([...aa].some(value => ab.has(value))) return true
  const containment = shared.length / Math.max(1, Math.min(a.size, b.size))
  const place = shared.some(token => PLACE.has(token)), event = shared.some(token => EVENT.has(token))
  return (place && event) || (shared.length >= 4 && containment >= 0.45)
}

export function selectRecallPromotions(scores, classification) {
  const dispositions = new Map((classification.results || []).map(item => [item.event?.id, item]))
  const baseline = (scores.results || []).filter(item => item.cohort === 'baseline')
  const promoted = [], overlapReview = [], reserve = [], rejected = []
  for (const item of (scores.results || []).filter(value => value.cohort === 'recall')) {
    const evaluation = item.evaluation || {}, disposition = dispositions.get(item.eventId)?.disposition || 'new-event-candidate'
    const overlap = baseline.find(existing => possibleThreadOverlap(item.headline, existing.headline))
    const record = { eventId: item.eventId, headline: item.headline, lane: item.lane, editorialScore: item.editorialScore, recommendation: evaluation.recommendation, disposition, possibleOverlapEventId: overlap?.eventId || null, possibleOverlapHeadline: overlap?.headline || null }
    if (evaluation.recommendation === 'reject') rejected.push({ ...record, reason: 'editorial recommendation rejected' })
    else if (disposition !== 'new-event-candidate' || overlap) overlapReview.push({ ...record, reason: disposition !== 'new-event-candidate' ? disposition : 'possible existing event thread' })
    else if (evaluation.recommendation === 'strong' && Number(item.editorialScore) >= 80) promoted.push(record)
    else reserve.push({ ...record, reason: 'worth preserving but did not clear the automatic strong-newcomer bar' })
  }
  return { promoted, overlapReview, reserve, rejected }
}

function render(output) {
  const lines = ['# Automatic targeted-recall promotion gate', '', `${output.promoted.length} promoted · ${output.overlapReview.length} overlap/update review · ${output.reserve.length} reserve · ${output.rejected.length} rejected.`, '']
  for (const [title, values] of [['Promoted', output.promoted], ['Overlap or update review', output.overlapReview], ['Reserve', output.reserve], ['Rejected', output.rejected]]) {
    lines.push(`## ${title}`, '')
    values.forEach(item => lines.push(`- **${item.headline}** — ${item.lane}, score ${item.editorialScore}${item.reason ? `; ${item.reason}` : ''}${item.possibleOverlapHeadline ? `; possible overlap: ${item.possibleOverlapHeadline}` : ''}`))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const scoresPath = value('--scores'), classificationPath = value('--classification'), outputDir = value('--output-dir')
  if (!scoresPath || !classificationPath || !outputDir) throw new Error('--scores, --classification and --output-dir are required')
  const [scores, classification] = await Promise.all([scoresPath, classificationPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const result = selectRecallPromotions(scores, classification)
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), sources: { scoresPath, classificationPath }, ...result }
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'RECALL_PROMOTIONS.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'RECALL_PROMOTIONS.md'), render(output)),
  ])
  process.stdout.write(`${JSON.stringify({ promoted: output.promoted.length, overlapReview: output.overlapReview.length, reserve: output.reserve.length, rejected: output.rejected.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
