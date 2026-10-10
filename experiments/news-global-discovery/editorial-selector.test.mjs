import test from 'node:test'
import assert from 'node:assert/strict'
import { auditBatch, chunks, combineScores, compactEvidence, computedScore, prepareEditorialFixture } from './editorial-selector.mjs'

test('compact evidence preserves opening context and later consequential facts', () => {
  const text = '.video { font-size: 2rem; padding-top: 4px; } Thank you for visiting example.com. Your browser version has limited support for JavaScript. A local dispute began this week. Residents requested basic services. Officials met on Tuesday. The talks continued. A small committee was formed. More background followed. Another paragraph appeared. Several residents were injured and two people were killed while seeking toilets and clean water. Closing context.'
  const compact = compactEvidence(text, { maxChars: 700 })
  assert.match(compact, /local dispute/)
  assert.match(compact, /injured and two people were killed/)
  assert.doesNotMatch(compact, /font-size|browser version/)
})

test('fixture preparation excludes major lanes and includes qualified reserves', () => {
  const make = (id, lane) => ({ id, representative: { selection: { assignedLane: lane, representative: { priorityRegions: ['Ghana'] } }, snapshot: { title: `Title ${id} contains enough words`, evidenceText: 'The first evidence sentence explains a concrete event involving local residents. A second sentence provides enough specific background for an editorial decision. A third sentence explains why the development matters to people in the affected place.', publishedAt: '2026-10-10T00:00:00Z', publisher: 'example.com', finalUrl: `https://example.com/${id}` } } })
  const fixture = prepareEditorialFixture({ events: [make('a', 'world-major'), make('b', 'world-interesting'), make('c', 'discovery')], qualifiedButNotSelected: [make('d', 'priority-interesting')] })
  assert.deepEqual(fixture.candidates.map(value => value.eventId), ['b', 'c', 'd'])
  assert.equal(fixture.candidates[0].source.publisher, 'example.com')
  assert.equal(fixture.candidates[2].baselineSelected, false)
})

test('fixture preparation excludes candidates emptied by boilerplate cleanup', () => {
  const event = { id: 'empty', representative: { selection: { assignedLane: 'world-interesting', representative: { priorityRegions: [] } }, snapshot: { title: 'A headline that is long enough for the gate', evidenceText: '.box { font-size: 2rem; }', publishedAt: '2026-10-10T00:00:00Z', publisher: 'example.com', finalUrl: 'https://example.com/empty' } } }
  const fixture = prepareEditorialFixture({ events: [event], qualifiedButNotSelected: [] })
  assert.equal(fixture.candidates.length, 0)
  assert.equal(fixture.excluded[0].eventId, 'empty')
})

test('batch helper is deterministic', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('batch audit requires every expected id exactly once', () => {
  const evaluation = id => ({ id, lane_fit: 4, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, recommendation: 'strong', strongest_fact: 'Fact', reason: 'Reason' })
  assert.equal(auditBatch({ evaluations: [evaluation('E001'), evaluation('E002')] }, ['E001', 'E002']).valid, true)
  assert.equal(auditBatch({ evaluations: [evaluation('E001'), evaluation('E001')] }, ['E001', 'E002']).valid, false)
})

test('computed score uses fixed editorial weights and combined ranking stays within lanes', () => {
  const high = { lane_fit: 5, substantive_value: 5, intrinsic_interest: 5, distinctiveness: 5, clarity: 5, freshness_specificity: 5 }
  const low = { lane_fit: 1, substantive_value: 1, intrinsic_interest: 1, distinctiveness: 1, clarity: 1, freshness_specificity: 1 }
  assert.equal(computedScore(high), 100)
  assert.equal(computedScore(low), 20)
  const fixture = { candidates: [
    { blindId: 'E001', lane: 'world-interesting', baselineRank: 1 },
    { blindId: 'E002', lane: 'world-interesting', baselineRank: 2 },
  ] }
  const report = combineScores(fixture, [{ evaluations: [{ id: 'E001', ...low }, { id: 'E002', ...high }] }])
  assert.deepEqual(report.map(value => value.blindId), ['E002', 'E001'])
})
