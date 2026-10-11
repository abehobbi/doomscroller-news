import test from 'node:test'
import assert from 'node:assert/strict'
import { buildShortlist, HARD_CAP, prepareMajorFixture, readinessForAssessment, selectLane, verificationFamilies } from './build-writer-ready-shortlist.mjs'

test('source readiness is conservative for each source state', () => {
  assert.equal(readinessForAssessment({ decision: 'provisionally-usable' }).ready, true)
  assert.equal(readinessForAssessment({ decision: 'needs-independent-corroboration' }, 0, 1).ready, false)
  assert.equal(readinessForAssessment({ decision: 'needs-independent-corroboration' }, 1, 1).ready, true)
  assert.equal(readinessForAssessment({ decision: 'needs-independent-context' }, 0, 1).ready, false)
  assert.equal(readinessForAssessment({ decision: 'needs-independent-context' }, 1, 1).ready, true)
  assert.equal(readinessForAssessment({ decision: 'replace-source' }, 0, 1).ready, false)
  assert.equal(readinessForAssessment({ decision: 'replace-source' }, 1, 1).ready, true)
})

test('supporting source count is based on independent domains', () => {
  assert.equal(verificationFamilies({ accepted: [{ domain: 'nasa.gov' }, { domain: 'nasa.gov' }, { domain: 'bbc.com' }] }), 2)
})

test('major fixture extracts only major lanes', () => {
  const make = (id, lane) => ({ id, members: [], sourceFamilies: ['x'], independentSourceCount: 1, representative: { selection: { assignedLane: lane, representative: { priorityRegions: [] } }, snapshot: { title: id, publisher: 'cbc.ca', finalUrl: `https://cbc.ca/${id}`, evidenceText: 'Concrete evidence '.repeat(30) } } })
  const fixture = prepareMajorFixture({ events: [make('major', 'world-major'), make('other', 'discovery')] })
  assert.deepEqual(fixture.events.map(value => value.eventId), ['major'])
})

test('shortlist deduplicates stable event ids and never exceeds lane or global caps', () => {
  const majorFixture = { events: [{ eventId: 'same', lane: 'world-major', baselineRank: 1, headline: 'Baseline event', evidence: 'Evidence', primarySource: { publisher: 'cbc.ca', url: 'https://cbc.ca/a' }, sources: [], independentSourceCount: 1 }] }
  const result = item => ({ blindId: item, eventId: item, lane: 'world-interesting', destination: 'world-interesting', headline: `Headline ${item}`, evidence: 'Evidence', source: { publisher: 'bbc.com', url: `https://bbc.com/${item}` }, sourceAssessment: { decision: 'provisionally-usable' }, evaluation: { recommendation: 'strong' }, editorialScore: 90, baselineRank: 1 })
  const safeguards = { results: [result('same'), ...Array.from({ length: 80 }, (_, index) => result(`e${index}`))] }
  safeguards.results[0].destination = 'world-major'
  const shortlist = buildShortlist(majorFixture, safeguards, { results: [] })
  assert.equal(shortlist.selected.filter(value => value.eventId === 'same').length, 1)
  assert.ok(shortlist.selected.length <= HARD_CAP)
  assert.equal(shortlist.laneCounts['world-interesting'], 20)
})

test('possible stories fill a shortfall but do not pad a lane after its minimum', () => {
  const candidate = (id, recommendation, score) => ({ eventId: id, editorialRecommendation: recommendation, editorialScore: score })
  const result = selectLane([
    candidate('s1', 'strong', 90), candidate('s2', 'strong', 80),
    candidate('p1', 'possible', 99), candidate('p2', 'possible', 98), candidate('p3', 'possible', 97),
  ], { minimum: 3, maximum: 5 })
  assert.deepEqual(result.selected.map(value => value.eventId), ['s1', 's2', 'p1'])
  assert.match(result.overflow[0].readiness.reason, /minimum was met/)
})

test('major-pool source verification can satisfy an original event gate', () => {
  const fixture = { events: [{ eventId: 'major-1', lane: 'world-major', baselineRank: 1, headline: 'A contested court allegation', evidence: 'Police faced an allegation.', primarySource: { publisher: 'bbc.com', url: 'https://bbc.com/a' }, sources: [], independentSourceCount: 1 }] }
  const verification = { results: [{ blindId: 'major-1', eventId: 'major-1', accepted: [{ domain: 'reuters.com', url: 'https://reuters.com/a' }] }] }
  const result = buildShortlist(fixture, { results: [] }, verification)
  assert.equal(result.selected.length, 1)
  assert.equal(result.selected[0].verificationStatus, 'one-supporting-source-family-found')
})
