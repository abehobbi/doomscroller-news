import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVerificationResult, relevantCandidate, verificationCandidates } from './verify-shortlist-sources.mjs'

test('verification candidates are strong non-major stories that still need source work', () => {
  const item = (id, recommendation, destination, decision, score) => ({ blindId: id, editorialScore: score, headline: id, destination, sourceAssessment: { decision }, evaluation: { recommendation, strongest_fact: 'fact' } })
  const report = { results: [
    item('keep', 'strong', 'world-interesting', 'needs-source-review', 90),
    item('ready', 'strong', 'discovery', 'provisionally-usable', 100),
    item('major', 'strong', 'world-major', 'needs-independent-corroboration', 99),
    item('weak', 'possible', 'priority-interesting', 'needs-source-review', 80),
  ] }
  assert.deepEqual(verificationCandidates(report).map(value => value.blindId), ['keep'])
})

test('writer shortlist verification prioritizes strong then baseline Major stories', () => {
  const item = (eventId, lane, recommendation, score) => ({ eventId, lane, headline: eventId, evidence: 'A concrete fact happened.', editorialRecommendation: recommendation, editorialScore: score, baselineRank: 1, primarySource: { publisher: 'bbc.com', url: `https://bbc.com/${eventId}` }, sourceAssessment: { decision: 'needs-independent-corroboration' } })
  const report = { withheld: [
    item('possible', 'world-major', 'possible', 100),
    item('baseline', 'priority-major', 'baseline-qualified', null),
    item('strong', 'world-major', 'strong', 80),
    item('interesting', 'world-interesting', 'strong', 99),
  ] }
  assert.deepEqual(verificationCandidates(report).map(value => value.eventId), ['strong', 'baseline'])
  assert.equal(verificationCandidates(report)[0].source.publisher, 'bbc.com')
})

test('an explicitly requested gap candidate may be possible and non-major', () => {
  const report = { withheld: [{ eventId: 'gap', lane: 'world-interesting', gapRecoveryRequested: true, headline: 'Gap story', evidence: 'A concrete local development.', editorialRecommendation: 'possible', primarySource: { publisher: 'example.com', url: 'https://example.com/gap' }, sourceAssessment: { decision: 'needs-source-review' } }] }
  assert.deepEqual(verificationCandidates(report).map(value => value.eventId), ['gap'])
})

test('source relevance requires multiple overlapping event terms', () => {
  const story = { headline: 'Ancient tablet archive found in Hittite palace', evaluation: { strongest_fact: 'Archaeologists found 184 cuneiform tablets.' } }
  const matching = relevantCandidate(story, { title: 'Archaeologists uncover Hittite cuneiform tablet archive', evidenceText: 'The palace archive contains 184 tablets.' })
  const unrelated = relevantCandidate(story, { title: 'Modern office archive opens', evidenceText: 'A company stored paper records.' })
  assert.equal(matching.passes, true)
  assert.equal(unrelated.passes, false)
})

test('supporting URLs from one publisher count as one source family', () => {
  const normalized = normalizeVerificationResult({ status: 'unresolved', accepted: [
    { domain: 'noirlab.edu', url: 'https://noirlab.edu/story' },
    { domain: 'noirlab.edu', url: 'https://noirlab.edu/story?lang=en' },
  ] })
  assert.equal(normalized.accepted.length, 1)
  assert.equal(normalized.status, 'one-supporting-source-family-found')
})
