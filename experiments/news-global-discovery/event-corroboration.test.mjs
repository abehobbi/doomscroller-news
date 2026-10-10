import assert from 'node:assert/strict'
import test from 'node:test'
import { clusterCorroboratedEvents, compareCandidateEvents, sourceFamily } from './event-corroboration.mjs'

const item = (id, title, description, publisher = 'example.com', publishedAt = '2026-10-10T10:00:00Z') => ({
  selection: { id, assignedLane: 'world-major', representative: { title, priorityRegions: [] } },
  snapshot: { title, evidenceText: description, evidenceChars: description.length, publisher, publishedAt, finalUrl: `https://${publisher}/${id}` },
})

test('near-identical headlines from independent publishers become one corroborated event', () => {
  const a = item('a', 'Bangladesh signs 15-year port deal with DP World', 'Bangladesh signed a 15-year port agreement with DP World, officials said.', 'one.test')
  const b = item('b', 'DP World signs 15-year Bangladesh port agreement', 'Officials reported that DP World signed a 15-year agreement to operate the Bangladesh port.', 'two.test')
  assert.equal(compareCandidateEvents(a, b).relation, 'same-event')
  const clusters = clusterCorroboratedEvents([a, b])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].independentSourceCount, 2)
  assert.equal(clusters[0].corroborationStatus, 'multi-source')
})

test('similar generic disaster wording in different locations stays separate', () => {
  const a = item('a', 'Flood kills residents in Bangladesh', 'Officials said flooding killed residents in Bangladesh.')
  const b = item('b', 'Flood kills residents in Panama', 'Officials said flooding killed residents in Panama.')
  assert.equal(compareCandidateEvents(a, b).relation, 'distinct-or-uncertain')
})

test('wire copies count as one source family', () => {
  const a = item('a', 'A concrete event headline', 'Reporting by Reuters. Officials announced the development.', 'paper-one.test')
  const b = item('b', 'A concrete event headline', 'Via Reuters. Officials announced the development.', 'paper-two.test')
  assert.equal(sourceFamily(a), 'wire:reuters')
  assert.equal(sourceFamily(b), 'wire:reuters')
  assert.equal(clusterCorroboratedEvents([a, b])[0].independentSourceCount, 1)
})

test('parenthetical AP byline is recognized as a wire family', () => {
  const value = item('a', 'Trade agreement announced', 'HONG KONG (AP) — Officials announced a preliminary trade agreement.', 'paper.test')
  assert.equal(sourceFamily(value), 'wire:ap')
})

test('different headlines about the same distinctive fossil cluster from evidence', () => {
  const a = item('a', 'Jurassic otter could chew like modern mammals', 'Researchers described Megacauda sungei, a Jurassic mammaliaform whose hyoid bones and soft palate show specialized swallowing anatomy.', 'university.test')
  const b = item('b', 'Surprising mammal fossil gives scientists something to chew on', 'The fossil of Megacauda sungei preserves the mammaliaform hyoid apparatus and evidence of specialized swallowing during the Jurassic.', 'radio.test')
  assert.equal(compareCandidateEvents(a, b).relation, 'same-event')
})

test('shared background about one port does not merge different operator negotiations', () => {
  const dp = item('dp', 'DP World gets 15-year concession to operate New Mooring Container Terminal', 'Bangladesh signed a concession with DP World for the New Mooring Container Terminal. The government is reforming Chattogram port operations.', 'one.test')
  const psa = item('psa', 'Govt in talks with Singapore PSA to operate more Ctg Port terminals', 'The government is negotiating with PSA about different Chattogram port terminals while reforms continue across the port.', 'two.test')
  assert.equal(compareCandidateEvents(dp, psa).relation, 'distinct-or-uncertain')
})
