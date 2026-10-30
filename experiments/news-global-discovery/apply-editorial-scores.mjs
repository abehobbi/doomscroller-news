import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'
import { normalizeGeneratedRouting } from './assemble-unattended-shadow-edition.mjs'

const LANE_MAXIMUMS = Object.freeze({
  'world-major': 15,
  'priority-major': 15,
  'world-interesting': 20,
  'priority-interesting': 15,
  discovery: 8,
})

function destinationLane(card, evaluation) {
  const recommended = evaluation?.recommended_lane
  if (recommended === 'discovery') return 'discovery'
  const priority = (card.priorityRegions || []).length > 0
  if (recommended) return `${priority ? 'priority' : 'world'}-${recommended.endsWith('major') && evaluation.major_qualification === true ? 'major' : 'interesting'}`
  if (!evaluation || (evaluation.lane_fit > 2 && evaluation.major_qualification !== false) || !card.lane.endsWith('major')) return card.lane
  return card.lane === 'priority-major' ? 'priority-interesting' : 'world-interesting'
}

const STATEMENT_ONLY_CUE = /\b(?:says?|said|states?|stated|declares?|declared|calls?\s+for|urges?|warns?|welcomes?|open\s+to|wants?|backs?|supports?|opposes?|pledges?|promises?|aims?|expects?|predicts?|believes?|questions?|criticises?|criticizes?)\b/i
const CONCRETE_DEVELOPMENT_CUE = /\b(?:signed|enacted|approved|adopted|passed|launched|opened|began|started|deployed|allocated|released|awarded|funded|filed|ordered|arrested|charged|resigned|appointed|elected|won|killed|injured|displaced|discovered|identified|published|recorded|confirmed|cancelled|canceled|closed|reopened|delivered|arrived|completed|broke\s+ground)\b/i
const DETERMINISTIC_LOW_VALUE = /\b(?:innovation fair|trade fair|study delegation|delegation (?:studies|visits|tours)|seeks? (?:cooperation|collaboration|partnership|support) to (?:establish|build|develop|launch)|agree(?:s|d)? to (?:(?:continue|hold|resume) (?:talks|dialogue|discussions)|more talks)|ballon d['’]or|wins? (?:the )?(?:men['’]s|women['’]s)? award|friendly match|league table)\b/i
const EXPLICIT_STALE_FINDING = /\b(?:study|research|paper|findings?|discovery|report)\b[^\n.]{0,140}\b(?:published|released|announced|unveiled|reported)\b[^\n.]{0,140}\b(?:in|on)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20(?:0\d|1\d|2[0-5])\b/i
const DISCOVERY_HEADLINE = /\b(?:archaeolog|fossil|scientists? (?:find|found|discover|map|develop|document)|researchers? (?:find|found|discover|document)|study finds?|new (?:x-ray|telescope|genetic|neuroscience) method|terra-?cotta|exoplanet|asteroids?|ancient (?:human|animal|site|settlement))\b/i

function isStatementOnlyPossible(score) {
  const evaluation = score?.evaluation
  if (evaluation?.recommendation !== 'possible') return false
  const strongestFact = String(evaluation.strongest_fact || '')
  return STATEMENT_ONLY_CUE.test(strongestFact) && !CONCRETE_DEVELOPMENT_CUE.test(strongestFact)
}

function editorialRejectionReason(score, card) {
  const evaluation = score?.evaluation
  if (!evaluation) return 'missing complete editorial score'
  const evidence = `${card?.headline || ''} ${(card?.pages || []).map(page => page.text).join(' ')}`
  if (DETERMINISTIC_LOW_VALUE.test(card?.headline || '')) return 'deterministic editorial gate rejected routine sport, publicity, delegation or aspirational cooperation'
  if (EXPLICIT_STALE_FINDING.test(evidence)) return 'deterministic freshness gate found an explicitly old underlying finding'
  if (evaluation.underlying_event_fresh === false) return 'the underlying event or finding predates the edition window without a material new development'
  if (evaluation.single_coherent_event === false) return 'candidate combines unrelated developments that must not become one card'
  if (evaluation.publicity_or_commentary === true) return 'routine publicity, commentary or ceremonial material should not consume edition space'
  if (evaluation.future_or_conditional_only === true) return 'proposal, preparedness assurance, planned action or conditional future event has no separate material development yet'
  if (evaluation.concrete_new_development === false) return 'no concrete new action, consequence, finding or documented change is supported'
  if (evaluation.recommendation === 'reject' || score.editorialScore < 45) return evaluation.reason
  if (isStatementOnlyPossible(score)) return 'the strongest fact is political or institutional messaging without a concrete new development'
  if (evaluation.recommendation === 'possible' && (
    score.editorialScore < 70
    || evaluation.substantive_value < 3
    || evaluation.distinctiveness < 3
  )) return 'replaceable finalist did not meet the minimum substance and distinctiveness floor'
  return null
}

export function applyEditorialScores(edition, scoreReport) {
  if (!scoreReport?.complete) throw new Error('Editorial scoring is incomplete; refusing to use partial model output.')
  const scores = new Map((scoreReport.results || []).map(result => [result.eventId, result]))
  const rejected = [], retained = []
  for (const card of edition.cards || []) {
    const score = scores.get(card.eventId)
    const rejectionReason = editorialRejectionReason(score, card)
    if (rejectionReason) {
      rejected.push({ eventId: card.eventId, headline: card.headline, reason: rejectionReason, editorialScore: score?.editorialScore })
      continue
    }
    const evidence = (card.pages || []).map(page => page.text).join(' ')
    const independentlyRoutedLane = DISCOVERY_HEADLINE.test(card.headline || '') ? 'discovery' : destinationLane(card, score.evaluation)
    const routed = normalizeGeneratedRouting(independentlyRoutedLane, card.priorityRegions, card.headline, card.headline, evidence)
    retained.push({
      ...card,
      lane: routed.lane,
      priorityRegions: routed.priorityRegions,
      selectionScore: score.editorialScore,
      editorialSelection: { score: score.editorialScore, ...score.evaluation },
    })
  }
  retained.sort((left, right) => right.selectionScore - left.selectionScore || Number(left.frontPageRank || 999) - Number(right.frontPageRank || 999))
  const laneCounts = Object.fromEntries(Object.keys(LANE_MAXIMUMS).map(lane => [lane, 0]))
  const withinMaximums = []
  for (const card of retained) {
    const maximum = LANE_MAXIMUMS[card.lane]
    if (maximum !== undefined && laneCounts[card.lane] >= maximum) {
      rejected.push({ eventId: card.eventId, headline: card.headline, reason: `${card.lane} reached its hard category maximum of ${maximum}`, editorialScore: card.selectionScore })
      continue
    }
    laneCounts[card.lane] = Number(laneCounts[card.lane] || 0) + 1
    withinMaximums.push(card)
  }
  const cards = rankFrontPage(withinMaximums), audit = auditEdition(cards)
  return {
    ...edition, createdAt: new Date().toISOString(), sourceEditionCreatedAt: edition.createdAt,
    editorialScoring: { model: scoreReport.configuration?.model || null, candidateCount: scoreReport.candidateCount, rejected },
    cards, audit,
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const editionPath = value('--edition'), scoresPath = value('--scores'), output = value('--output')
  if (!editionPath || !scoresPath || !output) throw new Error('--edition, --scores and --output are required')
  const [edition, scores] = await Promise.all([editionPath, scoresPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const result = applyEditorialScores(edition, scores)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ accepted: result.cards.length, rejected: result.editorialScoring.rejected.length, laneCounts: result.audit.laneCounts, regionCounts: result.audit.regionCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
