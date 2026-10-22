import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { auditEdition } from './assemble-verified-edition.mjs'
import { rankFrontPage } from './final-edition-ranker.mjs'

function destinationLane(card, evaluation) {
  if (!evaluation || evaluation.lane_fit > 2 || !card.lane.endsWith('major')) return card.lane
  return card.lane === 'priority-major' ? 'priority-interesting' : 'world-interesting'
}

function editorialRejectionReason(score) {
  const evaluation = score?.evaluation
  if (!evaluation) return 'missing complete editorial score'
  if (evaluation.recommendation === 'reject' || score.editorialScore < 45) return evaluation.reason
  if (evaluation.recommendation === 'possible' && (
    score.editorialScore < 60
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
    const rejectionReason = editorialRejectionReason(score)
    if (rejectionReason) {
      rejected.push({ eventId: card.eventId, headline: card.headline, reason: rejectionReason, editorialScore: score?.editorialScore })
      continue
    }
    retained.push({
      ...card,
      lane: destinationLane(card, score.evaluation),
      selectionScore: score.editorialScore,
      editorialSelection: { score: score.editorialScore, ...score.evaluation },
    })
  }
  retained.sort((left, right) => right.selectionScore - left.selectionScore || Number(left.frontPageRank || 999) - Number(right.frontPageRank || 999))
  const cards = rankFrontPage(retained), audit = auditEdition(cards)
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
