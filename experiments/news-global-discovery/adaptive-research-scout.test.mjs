import assert from 'node:assert/strict'
import test from 'node:test'
import { auditPlannedQueries, compactDiscoveryContext, compactRoundResults, MAX_TAVILY_CREDITS, MODEL, normalizePlannedQueries, planQueries, repairRepeatedPriorityRegions, resultMatchesRegion, ROUND_LANE_SHAPES, ROUND_SIZES, TAVILY_CREDITS_PER_SEARCH } from './adaptive-research-scout.mjs'

const make = (id, lane, region, query) => ({ id, lane, region, blind_spot: 'undercovered local life', rationale: 'fills a demonstrated omission', query })

test('adaptive planner uses eight deep Tavily searches across three rounds', () => {
  assert.deepEqual(ROUND_SIZES, [3, 3, 2]); assert.equal(TAVILY_CREDITS_PER_SEARCH, 2); assert.equal(ROUND_SIZES.reduce((sum, value) => sum + value, 0) * TAVILY_CREDITS_PER_SEARCH, MAX_TAVILY_CREDITS)
  assert.deepEqual(ROUND_LANE_SHAPES, [
    ['priority-interesting', 'priority-major', 'world-major'],
    ['priority-interesting', 'priority-major', 'discovery'],
    ['priority-interesting', 'world-interesting'],
  ])
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
  const valid = [make('syria', 'priority-interesting', 'Syria', 'Syrian accountability public services livelihoods and local consequences'), make('ghana', 'priority-major', 'Ghana', 'Ghana government accountability labour health and environmental developments'), make('major', 'world-major', null, 'consequential global conflict election court and public health developments')]
  assert.equal(auditPlannedQueries(valid, 3).valid, true)
  assert.equal(auditPlannedQueries([valid[0], { ...valid[0], id: 'copy' }], 2).reason, 'duplicate adaptive query')
  assert.equal(auditPlannedQueries([{ ...valid[1], region: null }], 1).reason, 'priority query lacks a supported region')
  assert.equal(auditPlannedQueries([{ ...valid[2], region: 'Ghana' }], 1).reason, 'non-priority query has a priority region')
  assert.equal(auditPlannedQueries([valid[0]], 1, [valid[0].query]).reason, 'query repeats an earlier round')
})

test('planner rejects operator-heavy searches and preserves the final priority sweep', () => {
  const finalRound = [make('canada', 'priority-interesting', 'Canada', 'Canada local accountability public services environment and livelihood reporting'), make('local', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')]
  assert.equal(auditPlannedQueries(finalRound, 2).valid, true)
  assert.equal(auditPlannedQueries([{ ...finalRound[0], query: 'Canada crafts OR heritage OR livelihoods news 2026' }, finalRound[1]], 2).reason, 'query contains search operators or dates')
  assert.equal(auditPlannedQueries([finalRound[0], { ...finalRound[1], lane: 'discovery' }], 2).reason, 'round 3 has the wrong lane mix')
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
  const priorityMajor = normalizePlannedQueries([make('bangladesh', 'priority-major', 'Bangladesh', 'Bangladesh government accountability health and labour developments')])
  assert.equal(priorityMajor[0].region, 'Bangladesh')
})

test('repeated priority regions are repaired with an unused undercovered regional sweep', () => {
  const prior = [make('syria', 'priority-interesting', 'Syria', 'Syria recent accountability public services health labour and livelihoods'), make('ghana', 'priority-major', 'Ghana', 'Ghana recent accountability public services health labour and livelihoods')]
  const planned = [make('repeat', 'priority-interesting', 'Syria', 'Syria recent accountability environment health labour and local consequences'), make('world', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')]
  const repaired = repairRepeatedPriorityRegions(planned, prior, { Bangladesh: 8, Canada: 4, GTA: 3, 'Middle East': 1 })
  assert.equal(repaired[0].region, 'Middle East')
  assert.match(repaired[0].query, /Middle East/)
  assert.equal(auditPlannedQueries(repaired, 2, prior, 3).valid, true)
})

test('planner deterministically repairs repeated priority coverage after bounded retries', async () => {
  const previous = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, confirmed: process.env.FREE_PLAN_CONFIRMED }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'; process.env.CLOUDFLARE_API_TOKEN = 'token'; process.env.FREE_PLAN_CONFIRMED = 'yes'
  const repeated = { queries: [make('repeat', 'priority-interesting', 'Syria', 'Syria recent accountability environment health labour and local consequences'), make('world', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')] }
  const prior = [make('syria', 'priority-interesting', 'Syria', 'Syria accountability public services health labour and livelihoods')]
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { response: JSON.stringify(repeated), usage: { neurons: 1 }, model: MODEL } }) })
  try {
    const result = await planQueries({ context: { requestedWindow: {}, pool: { regionCounts: { Ghana: 1 } } }, priorSearches: prior, count: 2, round: 3, fetchImpl })
    assert.equal(result.attempts, 3); assert.equal(result.deterministicRepair, 'priority searches must cover distinct regions across rounds'); assert.equal(result.queries[0].region, 'Middle East')
  } finally {
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', previous.account], ['CLOUDFLARE_API_TOKEN', previous.token], ['FREE_PLAN_CONFIRMED', previous.confirmed]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test('second-round feedback contains only bounded search-result metadata', () => {
  const compact = compactRoundResults([{ query: 'q', lane: 'world-interesting', region: null, blind_spot: 'local life', results: Array.from({ length: 20 }, (_, index) => ({ title: `Story ${index}`, url: `https://example.com/${index}`, published_date: '2026-10-23' })) }])
  assert.equal(compact[0].results.length, 12); assert.deepEqual(Object.keys(compact[0].results[0]), ['title', 'url', 'published_at'])
})

test('planner retries one malformed lane mix before any Tavily search', async () => {
  const previous = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, confirmed: process.env.FREE_PLAN_CONFIRMED }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'; process.env.CLOUDFLARE_API_TOKEN = 'token'; process.env.FREE_PLAN_CONFIRMED = 'yes'
  const invalid = { queries: [make('field', 'discovery', null, 'biologists document a previously unknown animal behavior'), make('local', 'world-interesting', null, 'remote island residents restore their only freshwater source')] }
  const valid = { queries: [make('ghana', 'priority-interesting', 'Ghana', 'Ghana accountability public services environment and livelihood reporting'), make('local', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')] }
  const payloads = [invalid, valid]; const requests = []
  const fetchImpl = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { response: JSON.stringify(payloads.shift()), usage: { neurons: 1 }, model: MODEL } }) } }
  try {
    const result = await planQueries({ context: { requestedWindow: {}, pool: {} }, count: 2, round: 3, fetchImpl })
    assert.equal(result.attempts, 2); assert.equal(requests.length, 2); assert.equal(JSON.parse(requests[1].messages[1].content).validation_retry, 'round 3 has the wrong lane mix')
  } finally {
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', previous.account], ['CLOUDFLARE_API_TOKEN', previous.token], ['FREE_PLAN_CONFIRMED', previous.confirmed]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test('planner retries malformed model JSON before any Tavily search', async () => {
  const previous = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, confirmed: process.env.FREE_PLAN_CONFIRMED }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'; process.env.CLOUDFLARE_API_TOKEN = 'token'; process.env.FREE_PLAN_CONFIRMED = 'yes'
  const valid = { queries: [make('ghana', 'priority-interesting', 'Ghana', 'Ghana accountability public services environment and livelihood reporting'), make('local', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')] }
  const responses = ['{"queries":[', JSON.stringify(valid)]; const requests = []
  const fetchImpl = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { response: responses.shift(), usage: { neurons: 1 }, model: MODEL } }) } }
  try {
    const result = await planQueries({ context: { requestedWindow: {}, pool: {} }, count: 2, round: 3, fetchImpl })
    assert.equal(result.attempts, 2); assert.equal(requests.length, 2); assert.equal(JSON.parse(requests[1].messages[1].content).validation_retry, 'response was not valid JSON')
  } finally {
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', previous.account], ['CLOUDFLARE_API_TOKEN', previous.token], ['FREE_PLAN_CONFIRMED', previous.confirmed]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test('planner retries a transient provider failure before abandoning the edition', async () => {
  const previous = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, confirmed: process.env.FREE_PLAN_CONFIRMED }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'; process.env.CLOUDFLARE_API_TOKEN = 'token'; process.env.FREE_PLAN_CONFIRMED = 'yes'
  const valid = { queries: [make('ghana', 'priority-interesting', 'Ghana', 'Ghana accountability public services environment and livelihood reporting'), make('local', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')] }
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 500, text: async () => 'temporary upstream failure' }
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { response: JSON.stringify(valid), usage: { neurons: 1 }, model: MODEL } }) }
  }
  try {
    const result = await planQueries({ context: { requestedWindow: {}, pool: {} }, count: 2, round: 3, fetchImpl })
    assert.equal(result.attempts, 2); assert.equal(calls, 2)
  } finally {
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', previous.account], ['CLOUDFLARE_API_TOKEN', previous.token], ['FREE_PLAN_CONFIRMED', previous.confirmed]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})
