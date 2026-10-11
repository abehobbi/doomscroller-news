import test from 'node:test'
import assert from 'node:assert/strict'
import { auditDecisions, combineSafeguards, prepareBoundaryCandidates, sourceAssessment } from './selection-safeguards.mjs'

test('boundary candidates include non-rejected interesting stories only', () => {
  const fixture = { candidates: [{ blindId: 'E001', evidence: 'x'.repeat(200) }, { blindId: 'E002', evidence: 'y'.repeat(200) }] }
  const scores = { results: [
    { blindId: 'E001', lane: 'world-interesting', evaluation: { recommendation: 'strong', strongest_fact: 'Fact' } },
    { blindId: 'E002', lane: 'discovery', evaluation: { recommendation: 'strong', strongest_fact: 'Fact' } },
    { blindId: 'E003', lane: 'priority-interesting', evaluation: { recommendation: 'reject', strongest_fact: 'Fact' } },
  ] }
  assert.deepEqual(prepareBoundaryCandidates(fixture, scores).map(value => value.id), ['E001'])
})

test('source policy requires corroboration for contested claims even from established publishers', () => {
  const result = sourceAssessment({ headline: 'Police accused of illegal detention', source: { publisher: 'bbc.com' }, evaluation: { strongest_fact: 'A court allegation was filed.' } })
  assert.equal(result.tier, 'established')
  assert.equal(result.decision, 'needs-independent-corroboration')
})

test('source policy replaces known derivative science sites', () => {
  assert.equal(sourceAssessment({ headline: 'A fossil was found', source: { publisher: 'scienmag.com' }, evaluation: {} }).decision, 'replace-source')
})

test('decision audit requires exact ids and bounded scores', () => {
  const decision = id => ({ id, destination: 'interesting', human_place_value: 4, major_news_value: 2, reason: 'Grounded human value.' })
  assert.equal(auditDecisions({ decisions: [decision('E1'), decision('E2')] }, ['E1', 'E2']).valid, true)
  assert.equal(auditDecisions({ decisions: [decision('E1')] }, ['E1', 'E2']).valid, false)
})

test('combined safeguards reroute major stories without changing geography scope', () => {
  const scores = { results: [
    { blindId: 'E1', lane: 'world-interesting', headline: 'War operation begins', source: { publisher: 'bbc.com' }, evaluation: { recommendation: 'strong', strongest_fact: 'Troops advanced.' } },
    { blindId: 'E2', lane: 'priority-interesting', headline: 'Election court ruling', source: { publisher: 'cbc.ca' }, evaluation: { recommendation: 'strong', strongest_fact: 'Court ruled.' } },
  ] }
  const decisions = [
    { id: 'E1', destination: 'major', human_place_value: 1, major_news_value: 5, reason: 'Major event.' },
    { id: 'E2', destination: 'major', human_place_value: 1, major_news_value: 5, reason: 'Major event.' },
  ]
  assert.deepEqual(combineSafeguards(scores, decisions).map(value => value.destination), ['world-major', 'priority-major'])
})

