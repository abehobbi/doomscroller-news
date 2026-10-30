import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEditorialScores } from './apply-editorial-scores.mjs'

const card = (eventId, lane, rank) => ({ eventId, lane, headline: eventId, frontPageRank: rank, pages: [{ text: 'Verified evidence.' }], priorityRegions: [], acceptedSources: [] })
const scored = (eventId, editorialScore, recommendation = 'strong', laneFit = 5, recommendedLane = 'world-interesting') => ({ eventId, editorialScore, evaluation: { recommendation, recommended_lane: recommendedLane, major_qualification: recommendedLane.endsWith('major'), future_or_conditional_only: false, lane_fit: laneFit, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, concrete_new_development: true, underlying_event_fresh: true, single_coherent_event: true, publicity_or_commentary: false, strongest_fact: 'Fact', reason: 'Reason' } })

test('editorial gate rejects weak finalists, demotes false major labels and orders peers by score', () => {
  const edition = { createdAt: 'before', cards: [card('weak', 'world-interesting', 1), card('museum', 'world-major', 2), card('best', 'world-interesting', 3), card('good', 'world-interesting', 4)] }
  const scoreReport = { complete: true, configuration: { model: 'test' }, candidateCount: 4, results: [scored('weak', 30, 'reject'), scored('museum', 75, 'strong', 2), scored('best', 95), scored('good', 70)] }
  scoreReport.results.find(value => value.eventId === 'museum').evaluation.recommended_lane = 'world-interesting'
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

test('possible statement-only stories are rejected while statements reporting concrete action survive', () => {
  const edition = { createdAt: 'before', cards: [card('willingness', 'priority-interesting', 1), card('signed-law', 'priority-major', 2)] }
  const willingness = scored('willingness', 65, 'possible')
  willingness.evaluation.strongest_fact = 'President Mahama stated he is open to foreign security assistance in the Sahel.'
  const signedLaw = scored('signed-law', 72, 'possible')
  signedLaw.evaluation.strongest_fact = 'The president said the newly enacted labour law was signed on Tuesday.'
  const result = applyEditorialScores(edition, { complete: true, candidateCount: 2, results: [willingness, signedLaw] })
  assert.deepEqual(result.cards.map(value => value.eventId), ['signed-law'])
  assert.deepEqual(result.editorialScoring.rejected.map(value => value.eventId), ['willingness'])
})

test('independent lane judgment routes research to discovery and demotes false major stories', () => {
  const archaeology = card('archaeology', 'world-major', 1); archaeology.headline = 'Fingerprints on terra-cotta warriors suggest women and children helped make them'
  const preparedness = card('preparedness', 'priority-major', 2); preparedness.priorityRegions = ['Ghana']; preparedness.headline = 'Ghana says it is ready to respond to Ebola'
  const archaeologyScore = scored('archaeology', 96, 'strong', 1, 'discovery')
  const preparednessScore = scored('preparedness', 76, 'strong', 2, 'priority-interesting'); preparednessScore.evaluation.major_qualification = false
  const result = applyEditorialScores({ createdAt: 'before', cards: [archaeology, preparedness] }, { complete: true, candidateCount: 2, results: [archaeologyScore, preparednessScore] })
  assert.equal(result.cards.find(value => value.eventId === 'archaeology').lane, 'discovery')
  assert.equal(result.cards.find(value => value.eventId === 'preparedness').lane, 'priority-interesting')
})

test('conditional future actions are rejected even when the scorer otherwise likes them', () => {
  const threatened = card('threatened-strike', 'priority-interesting', 1)
  const score = scored('threatened-strike', 88, 'strong', 5, 'priority-interesting'); score.evaluation.future_or_conditional_only = true
  const result = applyEditorialScores({ createdAt: 'before', cards: [threatened] }, { complete: true, candidateCount: 1, results: [score] })
  assert.equal(result.cards.length, 0)
  assert.match(result.editorialScoring.rejected[0].reason, /conditional future event/)
})

test('integrity gates reject stale recycling, publicity and bundled unrelated events', () => {
  const edition = { createdAt: 'before', cards: [card('stale', 'discovery', 1), card('publicity', 'priority-interesting', 2), card('bundle', 'world-major', 3), card('local-life', 'priority-interesting', 4)] }
  const stale = scored('stale', 85); stale.evaluation.underlying_event_fresh = false
  const publicity = scored('publicity', 85); publicity.evaluation.publicity_or_commentary = true
  const bundle = scored('bundle', 85); bundle.evaluation.single_coherent_event = false
  const localLife = scored('local-life', 85)
  const result = applyEditorialScores(edition, { complete: true, candidateCount: 4, results: [stale, publicity, bundle, localLife] })
  assert.deepEqual(result.cards.map(value => value.eventId), ['local-life'])
})

test('priority geography is normalized before the writer and edition audit', () => {
  const ghana = card('ghana-story', 'world-interesting', 1)
  ghana.headline = 'Ghana cocoa farmers adopt a new drought-resistant method'
  const result = applyEditorialScores({ createdAt: 'before', cards: [ghana] }, { complete: true, candidateCount: 1, results: [scored('ghana-story', 85)] })
  assert.equal(result.cards[0].lane, 'priority-interesting')
  assert.deepEqual(result.cards[0].priorityRegions, ['Ghana'])
})

test('hard category maximums are enforced after editorial routing', () => {
  const cards = Array.from({ length: 10 }, (_, index) => card(`science-${index}`, 'discovery', index + 1))
  const scores = cards.map((value, index) => scored(value.eventId, 100 - index, 'strong', 5, 'discovery'))
  const result = applyEditorialScores({ createdAt: 'before', cards }, { complete: true, candidateCount: 10, results: scores })
  assert.equal(result.cards.length, 8)
  assert.equal(result.audit.laneCounts.discovery, 8)
  assert.equal(result.editorialScoring.rejected.filter(value => /hard category maximum/.test(value.reason)).length, 2)
})

test('deterministic gate catches routine events and explicitly old findings even when model scores them strong', () => {
  const fair = card('fair', 'priority-interesting', 1); fair.headline = 'CSIR Innovation Fair connects researchers with commercial partners'
  const old = card('old-study', 'discovery', 2); old.headline = 'Urban birds respond differently to women and men'; old.pages = [{ text: 'The study was published in December 2025.' }]
  const result = applyEditorialScores({ createdAt: 'before', cards: [fair, old] }, { complete: true, candidateCount: 2, results: [scored('fair', 90), scored('old-study', 90)] })
  assert.equal(result.cards.length, 0)
  assert.equal(result.editorialScoring.rejected.length, 2)
})

test('deterministic gate catches old findings with journal attribution and talk-only diplomacy', () => {
  const old = card('old-journal', 'world-interesting', 1); old.headline = 'Bird behaviour surprises researchers'; old.pages = [{ text: 'The findings, published in the journal People and Nature in December 2025, showed a consistent effect.' }]
  const talks = card('talks-only', 'world-major', 2); talks.headline = 'Four countries agree to more talks for regional peace'; talks.pages = [{ text: 'Officials issued a statement saying dialogue would continue.' }]
  const result = applyEditorialScores({ createdAt: 'before', cards: [old, talks] }, { complete: true, candidateCount: 2, results: [scored('old-journal', 90), scored('talks-only', 90)] })
  assert.equal(result.cards.length, 0)
  assert.match(result.editorialScoring.rejected.find(item => item.eventId === 'old-journal').reason, /old underlying finding/)
  assert.match(result.editorialScoring.rejected.find(item => item.eventId === 'talks-only').reason, /routine sport, publicity, delegation or aspirational cooperation/)
})
