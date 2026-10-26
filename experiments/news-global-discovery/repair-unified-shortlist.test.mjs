import assert from 'node:assert/strict'
import test from 'node:test'

import { isWorthRepairing, mergeSources, pendingRepairCandidates, repairCandidates, repairObjective, repairSearchQuery, searchForRepair, secondChanceQuery } from './repair-unified-shortlist.mjs'
import { isTrustedDomain } from './verify-unified-shortlist.mjs'

test('repair candidates are bounded and ordered by selection strength', () => {
  const report = { repairQueue: [
    { eventId: 'low', selectionScore: 20, readiness: { reasons: [] } },
    { eventId: 'stale', selectionScore: 99, readiness: { reasons: ['headline explicitly identifies a reporting period that ended before the edition window'] } },
    { eventId: 'high', selectionScore: 80, readiness: { reasons: [] } },
  ] }
  assert.deepEqual(repairCandidates(report, 1).map(item => item.eventId), ['high'])
})

test('source-ready major leads needing corroboration outrank weaker publicity repairs', () => {
  const report = { repairQueue: [
    { eventId: 'publicity', lane: 'priority-interesting', selectionScore: 120, readiness: { highRisk: false, acceptedSourceCount: 0, reasons: [] } },
    { eventId: 'outbreak', lane: 'world-major', selectionScore: 58, readiness: { highRisk: true, acceptedSourceCount: 1, reasons: ['needs corroboration'] } },
  ] }
  assert.equal(repairCandidates(report, 1)[0].eventId, 'outbreak')
})

test('bounded repairs reserve one opportunity for every editorial lane', () => {
  const lanes = ['priority-major', 'world-major', 'priority-interesting', 'world-interesting', 'discovery']
  const report = { repairQueue: lanes.flatMap((lane, index) => [
    { eventId: `${lane}-top`, lane, selectionScore: 150 - index, readiness: { highRisk: lane.includes('major'), acceptedSourceCount: 1, reasons: [] } },
    { eventId: `${lane}-other`, lane, selectionScore: 80 - index, readiness: { highRisk: false, acceptedSourceCount: 0, reasons: [] } },
  ]) }
  assert.deepEqual(new Set(repairCandidates(report, 7).map(item => item.lane)), new Set(lanes))
})

test('repair budget skips routine rolling election pages and isolated road deaths', () => {
  assert.equal(isWorthRepairing({ headline: 'Live numbers: find your riding and local candidates' }), false)
  assert.equal(isWorthRepairing({ headline: 'Driver killed in Highway 404 collision' }), false)
  assert.equal(isWorthRepairing({ headline: 'School bus crash kills driver and forces mass evacuation' }), true)
})

test('source merging removes exact family and URL duplicates without hiding independent reports', () => {
  const source = domain => ({ domain, url: `https://${domain}/story` })
  const merged = mergeSources([source('bbc.com')], [source('bbc.com'), source('reuters.com')])
  assert.deepEqual(merged.map(item => item.domain), ['bbc.com', 'reuters.com'])
})

test('repair reassessment recognizes newly vetted publishers without another search', () => {
  assert.equal(isTrustedDomain('mbcradio.com'), true)
  assert.equal(isTrustedDomain('washingtonpost.com'), true)
  assert.equal(isTrustedDomain('rferl.org'), true)
  assert.equal(isTrustedDomain('pulse.com.gh'), true)
  assert.equal(isTrustedDomain('scientificamerican.com'), true)
  assert.equal(isTrustedDomain('theworld.org'), true)
})

test('checkpoint resume skips already completed repair candidates', () => {
  const candidates = [{ eventId: 'done' }, { eventId: 'pending' }]
  assert.deepEqual(pendingRepairCandidates(candidates, [{ eventId: 'done' }]), [{ eventId: 'pending' }])
})

test('second-chance searches target the actual unresolved blocker', () => {
  const objective = reasons => repairObjective({ readiness: { reasons } })
  assert.match(objective(['no verified publisher image recovered']), /event-specific article image/)
  assert.match(objective(['high-risk event lacks two independent trusted source families']), /genuinely independent/)
  assert.match(objective(['no accessible, relevant and fresh source evidence']), /original accessible report/)
})

test('second-chance queries are concise and explicitly seek independent corroboration', () => {
  const item = { headline: 'Major event under investigation | Reuters', opportunityRecovery: { attempt: 2, blocker: 'corroboration' } }
  assert.equal(secondChanceQuery(item), 'Major event under investigation independent report official statement')
})

test('repair search query keeps first-pass evidence but second chances stay concise', () => {
  const first = { headline: 'Fishing cat released with tracking collar', sources: [{ evidenceText: 'The animal recovered after months of treatment.' }] }
  assert.match(repairSearchQuery(first), /months of treatment/)
  const second = { headline: 'Major event | Reuters', opportunityRecovery: { attempt: 2, blocker: 'evidence' }, sources: [] }
  assert.equal(repairSearchQuery(second), 'Major event')
})

test('first-pass corroboration searches avoid source-copy bias from pasted evidence', () => {
  const item = {
    headline: 'Attackers kill health worker responding to Ebola case | Reuters',
    readiness: { reasons: ['high-risk event lacks two independent trusted source families'] },
    sources: [{ evidenceText: 'A long block of wording from the first publisher that should not be copied into search.' }],
  }
  assert.equal(repairSearchQuery(item), 'Attackers kill health worker responding to Ebola case independent report official statement')
})

test('Tavily repair uses one basic credit and normalizes publication dates', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body)
    assert.equal(body.search_depth, 'basic')
    assert.equal(body.include_raw_content, false)
    return new Response(JSON.stringify({ request_id: 'tvly-1', usage: { credits: 1 }, results: [{ title: 'Report', url: 'https://example.com/report', published_date: '2026-10-20T10:00:00Z' }] }))
  }
  try {
    const result = await searchForRepair('tavily', 'secret', { headline: 'A specific event', sources: [] })
    assert.equal(result.provider, 'tavily')
    assert.equal(result.creditsUsed, 1)
    assert.equal(result.results[0].publishedDate, '2026-10-20T10:00:00Z')
  } finally { globalThis.fetch = originalFetch }
})
