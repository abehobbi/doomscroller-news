import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_EDITORIAL_LANES, EDITORIAL_RUBRIC, auditBatch, chunks, combineScores, compactEvidence, computedScore, prepareEditorialFixture, prepareVerifiedEditorialFixture, resumableEvaluations, scoreBatch, shouldRetryStructuralFailure } from './editorial-selector.mjs'

test('compact evidence preserves opening context and later consequential facts', () => {
  const text = '.video { font-size: 2rem; padding-top: 4px; } Thank you for visiting example.com. Your browser version has limited support for JavaScript. A local dispute began this week. Residents requested basic services. Officials met on Tuesday. The talks continued. A small committee was formed. More background followed. Another paragraph appeared. Several residents were injured and two people were killed while seeking toilets and clean water. Closing context.'
  const compact = compactEvidence(text, { maxChars: 700 })
  assert.match(compact, /local dispute/)
  assert.match(compact, /injured and two people were killed/)
  assert.doesNotMatch(compact, /font-size|browser version/)
})

test('fixture preparation can include major lanes for head-to-head editorial review', () => {
  const make = lane => ({ id: lane, representative: { selection: { assignedLane: lane, representative: { priorityRegions: [] } }, snapshot: { title: `A complete ${lane} candidate headline`, evidenceText: 'A concrete new development occurred. Officials documented its effects on residents and institutions. The report provides enough factual evidence for editorial review. It identifies the decision, the people affected, the date, and the immediate consequence in clear language.', publishedAt: '2026-10-12T00:00:00Z', publisher: 'example.com', finalUrl: `https://example.com/${lane}` } } })
  const fixture = prepareEditorialFixture({ events: [make('world-major'), make('priority-major'), make('discovery')], qualifiedButNotSelected: [] }, { includedLanes: ALL_EDITORIAL_LANES })
  assert.deepEqual(fixture.candidates.map(item => item.lane), ['world-major', 'priority-major', 'discovery'])
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

test('selected-only fixture omits qualified reserves for a bounded final-edition review', () => {
  const make = (id, lane) => ({ id, representative: { selection: { assignedLane: lane, representative: { priorityRegions: [] } }, snapshot: { title: `Title ${id} contains enough words`, evidenceText: 'This evidence describes a specific recent event with enough context for a bounded editorial review. It identifies the people and place involved. It also explains why the development matters and supplies a concrete consequence for affected residents.', publishedAt: '2026-10-10T00:00:00Z', publisher: 'example.com', finalUrl: `https://example.com/${id}` } } })
  const fixture = prepareEditorialFixture({ events: [make('selected', 'world-interesting')], qualifiedButNotSelected: [make('reserve', 'world-interesting')] }, { includeReserves: false })
  assert.deepEqual(fixture.candidates.map(value => value.eventId), ['selected'])
})

test('verified finalists can be converted into a blind all-lane editorial fixture', () => {
  const fixture = prepareVerifiedEditorialFixture({ cards: [{
    eventId: 'verified', lane: 'world-major', headline: 'A specific verified development', publishedAt: '2026-10-20T12:00:00Z',
    priorityRegions: [], primaryUrl: 'https://example.com/story', acceptedSources: [{ domain: 'example.com' }],
    pages: [{ text: 'Officials documented a specific recent development affecting many residents. The verified evidence identifies the decision, the people involved, and the immediate consequences. A second paragraph supplies enough concrete context for editorial review.' }],
  }] })
  assert.equal(fixture.candidates.length, 1)
  assert.equal(fixture.candidates[0].eventId, 'verified')
  assert.equal(fixture.candidates[0].source.publisher, 'example.com')
})

test('batch helper is deterministic', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('batch audit requires every expected id exactly once', () => {
  const evaluation = id => ({ id, lane_fit: 4, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, recommendation: 'strong', strongest_fact: 'Fact', reason: 'Reason' })
  assert.equal(auditBatch({ evaluations: [evaluation('E001'), evaluation('E002')] }, ['E001', 'E002']).valid, true)
  assert.equal(auditBatch({ evaluations: [evaluation('E001'), evaluation('E001')] }, ['E001', 'E002']).valid, false)
})

test('only exact-id or provider-truncation failures receive one bounded retry', () => {
  const duplicate = { httpStatus: 200, providerParseError: null, parseError: null, audit: { valid: false, reason: 'duplicate candidate id' } }
  assert.equal(shouldRetryStructuralFailure(duplicate, 0), true)
  assert.equal(shouldRetryStructuralFailure(duplicate, 1), false)
  assert.equal(shouldRetryStructuralFailure({ ...duplicate, parseError: 'Expected comma', finishReason: 'length', audit: { valid: false, reason: 'evaluations array missing' } }, 0), true)
  assert.equal(shouldRetryStructuralFailure({ ...duplicate, parseError: 'Expected comma', finishReason: 'length', audit: { valid: false, reason: 'evaluations array missing' } }, 1), false)
  assert.equal(shouldRetryStructuralFailure({ ...duplicate, httpStatus: 429 }, 0), false)
  assert.equal(shouldRetryStructuralFailure({ ...duplicate, audit: { valid: false, reason: 'score outside integer 0-5 range' } }, 0), false)
})

test('scoring retries a duplicate-id response once and accounts for both attempts', async t => {
  const evaluation = id => ({ id, lane_fit: 4, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, recommendation: 'strong', strongest_fact: 'Fact', reason: 'Reason' })
  const responses = [
    { result: { response: { evaluations: [evaluation('E001'), evaluation('E001')] }, choices: [{ finish_reason: 'stop' }], usage: { neurons: 2, prompt_tokens: 10, completion_tokens: 4 } } },
    { result: { response: { evaluations: [evaluation('E001'), evaluation('E002')] }, choices: [{ finish_reason: 'stop' }], usage: { neurons: 3, prompt_tokens: 11, completion_tokens: 5 } } },
  ]
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    const body = responses[calls++]
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) }
  })
  const previousEnvironment = {
    freePlanConfirmed: process.env.FREE_PLAN_CONFIRMED,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  }
  t.after(() => {
    if (previousEnvironment.freePlanConfirmed === undefined) delete process.env.FREE_PLAN_CONFIRMED
    else process.env.FREE_PLAN_CONFIRMED = previousEnvironment.freePlanConfirmed
    if (previousEnvironment.accountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousEnvironment.accountId
    if (previousEnvironment.apiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN
    else process.env.CLOUDFLARE_API_TOKEN = previousEnvironment.apiToken
  })
  process.env.FREE_PLAN_CONFIRMED = 'yes'
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
  process.env.CLOUDFLARE_API_TOKEN = 'test-token'
  const result = await scoreBatch([
    { blindId: 'E001', lane: 'world-major', priorityRegions: [], headline: 'One', evidence: 'Evidence one', publishedAt: '2026-10-21T00:00:00Z' },
    { blindId: 'E002', lane: 'world-major', priorityRegions: [], headline: 'Two', evidence: 'Evidence two', publishedAt: '2026-10-21T00:00:00Z' },
  ], 1)
  assert.equal(calls, 2)
  assert.equal(result.complete, true)
  assert.equal(result.structuralRetryCount, 1)
  assert.equal(result.attempts[0].audit.reason, 'duplicate candidate id')
  assert.equal(result.usage.neurons, 5)
  assert.equal(result.usage.prompt_tokens, 21)
  assert.deepEqual(result.evaluations.map(value => value.id), ['E001', 'E002'])
})

test('resume accepts evaluations only from batches that passed as a whole', () => {
  const evaluation = id => ({ id, lane_fit: 4, substantive_value: 4, intrinsic_interest: 4, distinctiveness: 4, clarity: 4, freshness_specificity: 4, recommendation: 'strong', strongest_fact: 'Fact', reason: 'Reason' })
  const report = { calls: [
    { complete: false, evaluations: [evaluation('E001')] },
    { complete: true, evaluations: [evaluation('E002')] },
  ] }
  assert.deepEqual(resumableEvaluations(report, new Set(['E001', 'E002'])).map(value => value.id), ['E002'])
})

test('major-lane rubric recognizes targeted attacks on elected officials as potentially institutional news', () => {
  assert.match(EDITORIAL_RUBRIC, /targeted attack on an elected official can have democratic and institutional significance/i)
  assert.match(EDITORIAL_RUBRIC, /Copy each supplied candidate ID exactly once/i)
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
