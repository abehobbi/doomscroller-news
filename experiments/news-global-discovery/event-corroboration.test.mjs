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

test('pages collected for one targeted recovery story remain one event despite headline wording', () => {
  const left = item('gap-panama-earthquake-1be9b353f3', 'Major earthquake hits Panama, injures at least 27', 'A magnitude 7.7 earthquake struck Panama and damaged buildings and roads.', 'example-one.com')
  const right = item('gap-panama-earthquake-03d7602d04', 'Two powerful earthquakes and multiple aftershocks rock Panama', 'Panama reported aftershocks and evacuations following two strong tremors.', 'example-two.com')
  const comparison = compareCandidateEvents(left, right)
  assert.equal(comparison.relation, 'same-event')
  assert.match(comparison.reason, /same targeted recovery event/)
})

test('a false-positive page from a targeted recovery query remains a separate event', () => {
  const target = item('gap-bangladesh-pirojpur-corruption-e87392ed87', 'Eight firms, one family, Tk 1,200cr embezzled', 'The Daily Star investigated alleged public-works corruption in Pirojpur, Bangladesh.', 'example-one.com')
  const unrelated = item('gap-bangladesh-pirojpur-corruption-f1634f6b91', 'Money allegedly withdrawn for unfinished municipal projects', 'The allegations concern roads in Shariatpur and Naria municipality.', 'example-two.com')
  assert.equal(compareCandidateEvents(target, unrelated).relation, 'distinct-or-uncertain')
})

test('a regional live blog cannot corroborate a specific recovery event merely by sharing query terms', () => {
  const target = item('gap-syria-quneitra-incursion-1111111111', 'Israeli forces set up checkpoint and bulldoze farmland in Quneitra', 'Israeli forces entered the village of Saida al-Hanout in Quneitra and established a temporary checkpoint.', 'arabnews.com')
  const roundup = item('gap-syria-quneitra-incursion-2222222222', 'Iran war live: Trump rules out strikes today; Israeli forces raid Hebron', 'The regional live blog reports developments in Iran, Gaza and a military raid in Hebron.', 'theguardian.com')
  assert.equal(compareCandidateEvents(target, roundup).relation, 'distinct-or-uncertain')
})

test('shared background about one port does not merge different operator negotiations', () => {
  const dp = item('dp', 'DP World gets 15-year concession to operate New Mooring Container Terminal', 'Bangladesh signed a concession with DP World for the New Mooring Container Terminal. The government is reforming Chattogram port operations.', 'one.test')
  const psa = item('psa', 'Govt in talks with Singapore PSA to operate more Ctg Port terminals', 'The government is negotiating with PSA about different Chattogram port terminals while reforms continue across the port.', 'two.test')
  assert.equal(compareCandidateEvents(dp, psa).relation, 'distinct-or-uncertain')
})

test('different updates from the same named vessel tragedy cluster as one thread', () => {
  const rescue = item('rescue', 'Joint rescue effort saved 69 MV Barima survivors', 'The Coast Guard rescued passengers after the MV Barima wreck in Guyana.')
  const recovery = item('recovery', 'Bodies found far from MV Barima wreckage', 'Search teams recovered bodies while looking for survivors of the MV Barima wreck in Guyana.')
  assert.match(compareCandidateEvents(rescue, recovery).reason, /same named vessel/)
})

test('one meeting and its material policy update cluster when the evidence densely overlaps', () => {
  const meeting = item('meeting', 'Zelenskyy meets US envoy in Norway for peace talks', 'Ukrainian President Volodymyr Zelenskyy met US envoy Steve Witkoff in Oslo with Finnish President Alexander Stubb and Norwegian Prime Minister Jonas Gahr Store. They discussed negotiations and Russia.')
  const update = item('update', 'Zelenskyy says US intelligence sharing has been restored', 'Ukrainian President Volodymyr Zelenskyy said after meeting US envoy Steve Witkoff in Oslo that intelligence sharing and ballistic missile warnings were working. Finnish President Alexander Stubb and Norwegian Prime Minister Jonas Gahr Store attended discussions about negotiations and Russia.')
  assert.equal(compareCandidateEvents(meeting, update).relation, 'same-event')
})
