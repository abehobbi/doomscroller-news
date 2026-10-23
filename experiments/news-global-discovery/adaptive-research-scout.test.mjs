import assert from 'node:assert/strict'
import test from 'node:test'
import { auditPlannedQueries, compactDiscoveryContext, compactRoundResults, MAX_TAVILY_CREDITS, ROUND_SIZES } from './adaptive-research-scout.mjs'

const make = (id, lane, region, topic) => ({ id, lane, region, blind_spot: 'undercovered local life', rationale: 'fills a demonstrated omission', query: `Find a concrete original article published inside the supplied date window about ${topic}, excluding publicity, opinion, sport and generic summaries.` })

test('adaptive planner is bounded to five Tavily searches across two rounds', () => {
  assert.deepEqual(ROUND_SIZES, [3, 2]); assert.equal(ROUND_SIZES.reduce((sum, value) => sum + value, 0), MAX_TAVILY_CREDITS)
})

test('coverage digest exposes lane and region gaps without article bodies', () => {
  const digest = compactDiscoveryContext([{ candidates: [{ title: 'Village revives a river craft', lanes: ['world-interesting'], priorityRegions: [] }, { title: 'Accra market workers organize', lanes: ['priority-interesting'], priorityRegions: ['Ghana'] }] }])
  assert.equal(digest.candidateCount, 2); assert.deepEqual(digest.laneCounts, { 'world-interesting': 1, 'priority-interesting': 1 }); assert.deepEqual(digest.regionCounts, { Ghana: 1 }); assert.equal(digest.headlines.length, 2)
})

test('planner context is bounded even when discovery returns hundreds of candidates', () => {
  const digest = compactDiscoveryContext([{ candidates: Array.from({ length: 300 }, (_, index) => ({ title: `Distinct story ${index}`, lanes: ['world-interesting'], priorityRegions: [] })) }])
  assert.equal(digest.candidateCount, 300); assert.equal(digest.headlines.length, 80)
})

test('planned queries must be distinct, lane-correct and region-correct', () => {
  const valid = [make('local', 'world-interesting', null, 'a small-place livelihood change'), make('syria', 'priority-interesting', 'Syria', 'local cultural life in Syria'), make('field', 'discovery', null, 'a new archaeological field finding')]
  assert.equal(auditPlannedQueries(valid, 3).valid, true)
  assert.equal(auditPlannedQueries([valid[0], { ...valid[0], id: 'copy' }], 2).reason, 'duplicate adaptive query')
  assert.equal(auditPlannedQueries([{ ...valid[1], region: null }], 1).reason, 'priority query lacks a supported region')
  assert.equal(auditPlannedQueries([{ ...valid[0], region: 'Ghana' }], 1).reason, 'non-priority query has a priority region')
  assert.equal(auditPlannedQueries([valid[0]], 1, [valid[0].query]).reason, 'query repeats an earlier round')
})

test('second-round feedback contains only bounded search-result metadata', () => {
  const compact = compactRoundResults([{ query: 'q', lane: 'world-interesting', region: null, blind_spot: 'local life', results: Array.from({ length: 20 }, (_, index) => ({ title: `Story ${index}`, url: `https://example.com/${index}`, published_date: '2026-10-23' })) }])
  assert.equal(compact[0].results.length, 12); assert.deepEqual(Object.keys(compact[0].results[0]), ['title', 'url', 'published_at'])
})
