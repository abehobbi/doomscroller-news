import assert from 'node:assert/strict'
import test from 'node:test'
import { auditPlannedQueries, compactDiscoveryContext, compactRoundResults, deterministicFallbackQueries, FIXED_RECALL_QUERIES, MAX_TAVILY_CREDITS, MODEL, normalizePlannedQueries, planQueries, repairRepeatedPriorityRegions, resultMatchesRegion, ROUND_LANE_SHAPES, ROUND_SIZES, searchTavily, TAVILY_CREDITS_PER_SEARCH } from './adaptive-research-scout.mjs'

const make = (id, lane, region, query) => ({ id, lane, region, blind_spot: 'undercovered local life', rationale: 'fills a demonstrated omission', query })

test('adaptive planner plus fixed recall uses eleven deep searches within the monthly guard', () => {
  assert.deepEqual(ROUND_SIZES, [3, 3, 2]); assert.equal(TAVILY_CREDITS_PER_SEARCH, 2)
  assert.equal((ROUND_SIZES.reduce((sum, value) => sum + value, 0) + FIXED_RECALL_QUERIES.length) * TAVILY_CREDITS_PER_SEARCH, MAX_TAVILY_CREDITS)
  assert.equal(MAX_TAVILY_CREDITS, 22)
  assert.ok(MAX_TAVILY_CREDITS + 4 + 4 <= 30)
  assert.deepEqual(FIXED_RECALL_QUERIES[0].includeDomains, ['reuters.com', 'apnews.com'])
  assert.deepEqual(ROUND_LANE_SHAPES, [
    ['priority-interesting', 'priority-major', 'world-major'],
    ['priority-interesting', 'priority-major', 'discovery'],
    ['priority-interesting', 'world-interesting'],
  ])
})

test('fixed recall searches send publisher-domain constraints to Tavily', async () => {
  let request
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body)
    return { ok: true, status: 200, text: async () => JSON.stringify({ request_id: 'test', usage: { credits: 2 }, results: [] }) }
  }
  await searchTavily(FIXED_RECALL_QUERIES[0], { start: '2026-10-29T00:00:00Z', end: '2026-10-30T00:00:00Z' }, 'test', fetchImpl)
  assert.deepEqual(request.include_domains, ['reuters.com', 'apnews.com'])
  assert.equal(request.search_depth, 'advanced')
  assert.equal(request.filter_by_published_date, true)
})

test('coverage digest exposes lane and region gaps without article bodies', () => {
  const digest = compactDiscoveryContext([{ candidates: [{ title: 'Village revives a river craft', url: 'https://local.example/a', lanes: ['world-interesting'], priorityRegions: [] }, { title: 'Accra market workers organize', url: 'https://ghana.example/b', lanes: ['priority-interesting'], priorityRegions: ['Ghana'] }] }])
  assert.equal(digest.candidateCount, 2); assert.deepEqual(digest.laneCounts, { 'world-interesting': 1, 'priority-interesting': 1 }); assert.deepEqual(digest.regionCounts, { Ghana: 1 }); assert.deepEqual(digest.publisherCounts, { 'local.example': 1, 'ghana.example': 1 }); assert.equal(digest.headlines.length, 2)
})

test('planner context is bounded even when discovery returns hundreds of candidates', () => {
  const digest = compactDiscoveryContext([{ candidates: Array.from({ length: 300 }, (_, index) => ({ title: `Distinct story ${index}`, lanes: ['world-interesting'], priorityRegions: [] })) }])
  assert.equal(digest.candidateCount, 300); assert.equal(digest.headlines.length, 80)
})

test('coverage digest preserves rare publishers and lanes beyond the first thirty candidates', () => {
  const common = Array.from({ length: 50 }, (_, index) => ({ title: `Common story ${index}`, url: `https://common.example/${index}`, lanes: ['world-major'], priorityRegions: [] }))
  const rare = { title: 'Rare district labour investigation', url: 'https://rare.example/story', lanes: ['priority-interesting'], priorityRegions: ['Bangladesh'] }
  const digest = compactDiscoveryContext([{ candidates: [...common, rare] }], { maximumHeadlines: 35 })
  assert.ok(digest.headlines.some(item => item.title === rare.title))
  assert.ok(digest.headlines.some(item => item.publisher === 'rare.example'))
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

test('planner query length is normalized before strict validation', () => {
  const long = make('ghana', 'priority-interesting', 'Ghana', 'Ghana local accountability public services environment labour livelihoods culture community health education water sanitation reporting consequences')
  const short = make('world', 'world-interesting', null, 'local consequences')
  const normalized = normalizePlannedQueries([long, short])
  assert.equal(normalized[0].query.split(/\s+/).length, 16)
  assert.equal(normalized[1].query.split(/\s+/).length, 6)
  assert.match(normalized[0].query, /^Ghana\b/)
})

test('repeated priority regions are repaired with an unused undercovered regional sweep', () => {
  const prior = [make('syria', 'priority-interesting', 'Syria', 'Syria recent accountability public services health labour and livelihoods'), make('ghana', 'priority-major', 'Ghana', 'Ghana recent accountability public services health labour and livelihoods')]
  const planned = [make('repeat', 'priority-interesting', 'Syria', 'Syria recent accountability environment health labour and local consequences'), make('world', 'world-interesting', null, 'underreported local accountability public services and livelihood consequences worldwide')]
  const repaired = repairRepeatedPriorityRegions(planned, prior, { Bangladesh: 8, Canada: 4, GTA: 3, 'Middle East': 1 })
  assert.equal(repaired[0].region, 'Middle East')
  assert.match(repaired[0].query, /Middle East/)
  assert.equal(auditPlannedQueries(repaired, 2, prior, 3).valid, true)
})

test('deterministic fallback preserves lane shape and unused priority regions', () => {
  const prior = [make('syria', 'priority-interesting', 'Syria', 'Syria accountability public services health labour and livelihoods'), make('ghana', 'priority-major', 'Ghana', 'Ghana accountability public services health labour and livelihoods')]
  const fallback = deterministicFallbackQueries(2, prior, { Bangladesh: 5, Canada: 2, GTA: 4, 'Middle East': 1 })
  assert.equal(auditPlannedQueries(fallback, 3, prior, 2).valid, true)
  assert.deepEqual(fallback.map(item => item.lane), ROUND_LANE_SHAPES[1])
  assert.deepEqual(fallback.filter(item => item.region).map(item => item.region), ['Middle East', 'Canada'])
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

test('planner falls back deterministically after repeated duplicate searches', async () => {
  const previous = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, confirmed: process.env.FREE_PLAN_CONFIRMED }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'; process.env.CLOUDFLARE_API_TOKEN = 'token'; process.env.FREE_PLAN_CONFIRMED = 'yes'
  const prior = [make('syria', 'priority-interesting', 'Syria', 'Syria accountability public services health labour and livelihoods')]
  const repeated = { queries: [make('repeat', 'priority-interesting', 'Ghana', prior[0].query), make('major', 'priority-major', 'Bangladesh', 'Bangladesh government accountability health labour and infrastructure developments'), make('field', 'discovery', null, 'recent archaeology ecology medicine field research discoveries overlooked worldwide')] }
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { response: JSON.stringify(repeated), usage: { neurons: 1 }, model: MODEL } }) })
  try {
    const result = await planQueries({ context: { requestedWindow: {}, pool: { regionCounts: { 'Middle East': 1, Canada: 2 } } }, priorSearches: prior, count: 3, round: 2, fetchImpl })
    assert.equal(result.attempts, 3); assert.equal(result.deterministicFallback, 'query repeats an earlier round')
    assert.equal(auditPlannedQueries(result.queries, 3, prior, 2).valid, true)
  } finally {
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID', previous.account], ['CLOUDFLARE_API_TOKEN', previous.token], ['FREE_PLAN_CONFIRMED', previous.confirmed]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})
