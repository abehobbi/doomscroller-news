import assert from 'node:assert/strict'
import test from 'node:test'
import { auditPlannedQueries, compactDiscoveryContext, compactRoundResults, MAX_TAVILY_CREDITS, normalizePlannedQueries, resultMatchesRegion, ROUND_SIZES, TAVILY_CREDITS_PER_SEARCH } from './adaptive-research-scout.mjs'

const make = (id, lane, region, query) => ({ id, lane, region, blind_spot: 'undercovered local life', rationale: 'fills a demonstrated omission', query })

test('adaptive planner converts ten Tavily credits into ten breadth searches', () => {
  assert.deepEqual(ROUND_SIZES, [6, 4]); assert.equal(TAVILY_CREDITS_PER_SEARCH, 1); assert.equal(ROUND_SIZES.reduce((sum, value) => sum + value, 0) * TAVILY_CREDITS_PER_SEARCH, MAX_TAVILY_CREDITS)
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
  const valid = [make('local', 'world-interesting', null, 'small town livelihood change reported by local journalists'), make('syria', 'priority-interesting', 'Syria', 'Syrian artisans revive a threatened traditional craft'), make('field', 'discovery', null, 'archaeologists announce a newly excavated ancient settlement')]
  assert.equal(auditPlannedQueries(valid, 3).valid, true)
  assert.equal(auditPlannedQueries([valid[0], { ...valid[0], id: 'copy' }], 2).reason, 'duplicate adaptive query')
  assert.equal(auditPlannedQueries([{ ...valid[1], region: null }], 1).reason, 'priority query lacks a supported region')
  assert.equal(auditPlannedQueries([{ ...valid[0], region: 'Ghana' }], 1).reason, 'non-priority query has a priority region')
  assert.equal(auditPlannedQueries([valid[0]], 1, [valid[0].query]).reason, 'query repeats an earlier round')
})

test('expanded rounds cover all depth lanes and distinct priority regions', () => {
  const firstRound = [
    make('world-1', 'world-interesting', null, 'remote island residents restore their only freshwater source'),
    make('world-2', 'world-interesting', null, 'local reporters reveal hidden costs of a mining boom'),
    make('syria', 'priority-interesting', 'Syria', 'Syrian artisans revive a threatened traditional weaving practice'),
    make('ghana', 'priority-interesting', 'Ghana', 'Ghana coastal fishers document a changing marine livelihood'),
    make('science-1', 'discovery', null, 'archaeologists identify an unknown settlement through ancient pollen'),
    make('science-2', 'discovery', null, 'biologists document a newly observed animal cooperation behavior'),
  ]
  assert.equal(auditPlannedQueries(firstRound, 6).valid, true)
  assert.equal(auditPlannedQueries([...firstRound.slice(0, 3), { ...firstRound[3], region: 'Syria', query: 'Syria coastal fishers document a changing marine livelihood' }, ...firstRound.slice(4)], 6).reason, 'priority queries repeat a region within one round')
})

test('planner rejects operator-heavy searches and preserves both obscure lanes', () => {
  const secondRound = [make('local-1', 'world-interesting', null, 'remote island residents restore their only freshwater source'), make('local-2', 'world-interesting', null, 'small town workers expose an overlooked environmental burden'), make('ghana', 'priority-interesting', 'Ghana', 'Ghana farming community adapts a threatened local livelihood'), make('field', 'discovery', null, 'biologists document a previously unknown animal behavior')]
  assert.equal(auditPlannedQueries(secondRound, 4).valid, true)
  assert.equal(auditPlannedQueries([{ ...secondRound[0], query: 'local crafts OR heritage OR livelihoods news 2026' }, ...secondRound.slice(1)], 4).reason, 'query contains search operators or dates')
  assert.equal(auditPlannedQueries([secondRound[0], { ...secondRound[1], lane: 'discovery' }, secondRound[2], secondRound[3]], 4).reason, 'round two must contain one priority, two world-interesting and one discovery query')
})

test('priority-region results cannot inherit a false geographic label', () => {
  assert.equal(resultMatchesRegion({ title: 'Accra market traders protect a historic craft', content: '', url: 'https://example.com/story' }, 'Ghana'), true)
  assert.equal(resultMatchesRegion({ title: 'Siege of Taiz deepens food insecurity', content: 'Yemeni families face shortages', url: 'https://example.com/story' }, 'Ghana'), false)
  assert.equal(resultMatchesRegion({ title: 'A neighborhood clinic changes its hours', content: 'Residents in Mississauga responded', url: 'https://example.com/story' }, 'GTA'), true)
})

test('non-priority planner metadata is canonicalized without weakening priority validation', () => {
  const normalized = normalizePlannedQueries([make('field', 'discovery', 'Ghana', 'biologists document a previously unknown animal behavior')])
  assert.equal(normalized[0].region, null)
  const priority = normalizePlannedQueries([make('ghana', 'priority-interesting', 'Ghana', 'coastal Ghana fishers restore a threatened local livelihood')])
  assert.equal(priority[0].region, 'Ghana')
})

test('second-round feedback contains only bounded search-result metadata', () => {
  const compact = compactRoundResults([{ query: 'q', lane: 'world-interesting', region: null, blind_spot: 'local life', results: Array.from({ length: 20 }, (_, index) => ({ title: `Story ${index}`, url: `https://example.com/${index}`, published_date: '2026-10-23' })) }])
  assert.equal(compact[0].results.length, 12); assert.deepEqual(Object.keys(compact[0].results[0]), ['title', 'url', 'published_at'])
})
