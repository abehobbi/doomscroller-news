import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTrialItem, buildVerificationIndex, chooseTrialCandidates, LANES, numericAudit, relativeTimeAudit } from './writer-shortlist-trial.mjs'

test('trial chooses one multi-source candidate from every lane and prefers Syria in a priority tie', () => {
  const item = (eventId, lane, sources, regions = []) => ({ eventId, lane, headline: eventId, evidence: 'A complete factual sentence explains the event. Another complete sentence explains why it matters.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: regions, editorialRecommendation: 'strong', editorialScore: 90, independentSourceCount: sources, primarySource: { publisher: 'bbc.com', url: `https://bbc.com/${eventId}` }, sources: [{ publisher: 'bbc.com', url: `https://bbc.com/${eventId}` }] })
  const selected = LANES.flatMap(lane => lane === 'priority-major'
    ? [item('canada', lane, 2, ['Canada']), item('syria', lane, 2, ['Syria'])]
    : [item(lane, lane, 2)])
  const chosen = chooseTrialCandidates({ selected })
  assert.equal(chosen.length, 5)
  assert.equal(chosen.find(value => value.lane === 'priority-major').eventId, 'syria')
})

test('trial packet exposes only propositions from verified supporting sources', () => {
  const candidate = { eventId: 'e1', lane: 'world-major', headline: 'Headline', evidence: 'The event happened in one place. Officials confirmed the outcome.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: [], independentSourceCount: 2, primarySource: { publisher: 'bbc.com', url: 'https://bbc.com/a' }, sources: [{ publisher: 'bbc.com', url: 'https://bbc.com/a' }, { publisher: 'reuters.com', url: 'https://reuters.com/a' }, { publisher: 'unknown.com', url: 'https://unknown.com/a' }] }
  const reports = [{ results: [{ accepted: [{ domain: 'reuters.com', url: 'https://reuters.com/a', propositions: ['Reuters independently reported the same event.', 'Its report supplied additional detail.'] }] }] }]
  const item = buildTrialItem(candidate, buildVerificationIndex(reports))
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions.length, 1)
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions[0].publisher, 'reuters.com')
})

test('numeric audit recognizes a preserved approximate quarter-million expression', () => {
  const packet = { fact: 'The project cost almost a quarter of a million Canadian dollars.' }
  const preserved = { headline: 'Project update', pages: [{ text: 'The project cost nearly 250,000 Canadian dollars.' }] }
  const overstated = { headline: 'Project update', pages: [{ text: 'The project cost 250,000 Canadian dollars.' }] }
  assert.equal(numericAudit(preserved, packet).valid, true)
  assert.equal(numericAudit(overstated, packet).valid, false)
})

test('relative-time audit rejects a next-week claim absent from the packet', () => {
  const packet = { temporal_facts_writer_may_state: { unresolved_relative_time: [] } }
  const card = { headline: 'Trial update', pages: [{ text: 'The trial is scheduled to begin next week.' }] }
  assert.deepEqual(relativeTimeAudit(card, packet).unsupportedExpressions, ['next week'])
})
