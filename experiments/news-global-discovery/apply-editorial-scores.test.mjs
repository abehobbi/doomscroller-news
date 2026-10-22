import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEditorialScores } from './apply-editorial-scores.mjs'

const card = (eventId, lane, rank) => ({ eventId, lane, headline: eventId, frontPageRank: rank, pages: [{ text: 'Verified evidence.' }], priorityRegions: [], acceptedSources: [] })
const scored = (eventId, editorialScore, recommendation = 'strong', laneFit = 5) => ({ eventId, editorialScore, evaluation: { recommendation, lane_fit: laneFit, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, strongest_fact: 'Fact', reason: 'Reason' } })

test('editorial gate rejects weak finalists, demotes false major labels and orders peers by score', () => {
  const edition = { createdAt: 'before', cards: [card('weak', 'world-interesting', 1), card('museum', 'world-major', 2), card('best', 'world-interesting', 3), card('good', 'world-interesting', 4)] }
  const scoreReport = { complete: true, configuration: { model: 'test' }, candidateCount: 4, results: [scored('weak', 30, 'reject'), scored('museum', 75, 'strong', 2), scored('best', 95), scored('good', 70)] }
  const result = applyEditorialScores(edition, scoreReport)
  assert.deepEqual(result.cards.map(value => value.eventId), ['best', 'museum', 'good'])
  assert.equal(result.cards.find(value => value.eventId === 'museum').lane, 'world-interesting')
  assert.deepEqual(result.editorialScoring.rejected.map(value => value.eventId), ['weak'])
})

test('editorial gate fails closed on incomplete scoring', () => {
  assert.throws(() => applyEditorialScores({ cards: [] }, { complete: false }), /incomplete/)
})

test('replaceable possible stories need real substance while strong niche stories remain eligible', () => {
  const edition = { createdAt: 'before', cards: [card('routine-school', 'world-interesting', 1), card('local-craft', 'priority-interesting', 2), card('strong-low-score', 'world-interesting', 3)] }
  const routine = scored('routine-school', 59, 'possible'); routine.evaluation.substantive_value = 2; routine.evaluation.distinctiveness = 2
  const craft = scored('local-craft', 78, 'possible'); craft.evaluation.substantive_value = 3; craft.evaluation.distinctiveness = 4
  const strong = scored('strong-low-score', 58, 'strong'); strong.evaluation.substantive_value = 3; strong.evaluation.distinctiveness = 3
  const result = applyEditorialScores(edition, { complete: true, candidateCount: 3, results: [routine, craft, strong] })
  assert.deepEqual(result.cards.map(value => value.eventId), ['local-craft', 'strong-low-score'])
  assert.deepEqual(result.editorialScoring.rejected.map(value => value.eventId), ['routine-school'])
})
