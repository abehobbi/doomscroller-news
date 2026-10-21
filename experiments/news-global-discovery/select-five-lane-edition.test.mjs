import assert from 'node:assert/strict'
import test from 'node:test'
import { candidatesDescribeSameThread, domainDiversityPenalty, lowConsequenceEvent, scoreCandidate, selectEdition } from './select-five-lane-edition.mjs'

const candidate = (title, lanes, priorityRegions = []) => ({
  title, lanes, priorityRegions, url: 'https://bbc.com/story', publishedAt: '2026-10-13T08:00:00Z',
  queryIds: [], bestPosition: 1, image: 'https://bbc.com/image.jpg',
})

test('major events in priority geography count as priority-major when found by a major-news search', () => {
  const fromWorldQuery = scoreCandidate(candidate('Houthi attack on Riyadh airport kills 12', ['world-major'], ['Middle East']), '2026-10-13T10:00:00Z')
  assert.deepEqual(fromWorldQuery.lanes, ['priority-major'])
})

test('priority-interesting searches do not promote stories without a major-news discovery signal', () => {
  const result = scoreCandidate(candidate('Ontario grower disqualified after 1,711-pound pumpkin developed soft spot', ['priority-interesting'], ['Canada']), '2026-10-13T10:00:00Z')
  assert.deepEqual(result.lanes, ['priority-interesting'])
})

test('a concrete consequential headline can recover a major lane even when a feed labeled it interesting', () => {
  const shipping = scoreCandidate(candidate('Two commercial ships sink near the Strait of Hormuz', ['world-interesting']), '2026-10-13T10:00:00Z')
  assert.ok(shipping.lanes.includes('priority-major'))
  assert.ok(shipping.priorityRegions.includes('Middle East'))
  const hunger = scoreCandidate(candidate('Nearly 16 million Afghans face crisis-level hunger', ['world-interesting']), '2026-10-13T10:00:00Z')
  assert.ok(hunger.lanes.includes('world-major'))
})

test('shared amounts do not merge unrelated science and public spending stories', () => {
  const fossil = { title: 'The fossil record may be missing 200 million years of animal history' }
  const hospital = { title: 'Ghana allocates 200 million cedis for police hospital expansion' }
  assert.equal(candidatesDescribeSameThread(fossil, hospital), false)
})

test('different disease outbreaks in different countries never become one event thread', () => {
  assert.equal(candidatesDescribeSameThread(
    { title: 'Measles death toll in Bangladesh reaches 1,196 after 7 more children die' },
    { title: 'Congo Ebola outbreak spreads as more children die' },
  ), false)
})

test('rescue and body-recovery updates for the same named vessel remain one event thread', () => {
  assert.equal(candidatesDescribeSameThread(
    { title: 'Joint rescue effort saved 69 MV Barima survivors' },
    { title: 'Bodies found 36 nautical miles from MV Barima wreckage' },
  ), true)
})

test('generic statements and ceremonial partnerships cannot fill an edition', () => {
  assert.equal(lowConsequenceEvent('President urges churches to provide practical community service'), true)
  assert.equal(lowConsequenceEvent('Watch company partners with school for 150th anniversary'), true)
  assert.equal(lowConsequenceEvent('Saudi Arabia reaffirms support for refugee returns'), true)
  assert.equal(lowConsequenceEvent('Government signs agreement funding 49 school repairs'), false)
  assert.equal(scoreCandidate(candidate('Prime minister showcases country at annual meeting', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').lowConsequence, true)
  assert.equal(lowConsequenceEvent('President cuts sod for industrial park project'), true)
  assert.equal(lowConsequenceEvent('Power shortages threaten economic plan, says professor'), true)
  assert.equal(lowConsequenceEvent('Minister highlights need for African unity in mining'), true)
  assert.equal(lowConsequenceEvent('Efforts needed to address plight of rural women'), true)
  assert.equal(lowConsequenceEvent('Education reforms must go beyond curriculum, state minister says'), true)
  assert.equal(lowConsequenceEvent('New KG block and borehole commissioned at district school'), true)
  assert.equal(lowConsequenceEvent('Ottawa unveils downtown heritage mural'), true)
  assert.equal(lowConsequenceEvent('Ghana signs $28bn petroleum hub partnership with foreign company'), true)
  assert.equal(lowConsequenceEvent('Ghana partnership releases funding and construction begins on petroleum hub'), false)
  assert.ok(scoreCandidate(candidate('Consulate to launch property expo next month', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('Habitat Fair closes with fun and big sales', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('Club suffers first defeat as rivals return to winning ways', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('IMF signs agreement over holding annual meetings in capital', ['priority-interesting']), '2026-10-13T10:00:00Z').score < 0)
})

test('candidate review can exceed a soft lane maximum before verification', () => {
  const clusters = Array.from({ length: 21 }, (_, index) => ({
    id: `event-${index}`,
    lanes: ['world-interesting'],
    members: [{ priorityRegions: [] }],
    representative: {
      title: `Distinct reporting project ${index}`,
      domain: `source-${index}.test`,
      score: 70,
      laneScores: { 'world-interesting': 70 },
      ageHours: 2,
      priorityRegions: [],
    },
  }))
  const result = selectEdition(clusters, 21)
  assert.equal(result.selected.length, 21)
  assert.equal(result.counts['world-interesting'], 21)
})

test('publisher diversity remains a preference rather than an exclusion wall', () => {
  assert.equal(domainDiversityPenalty(1), 0)
  assert.equal(domainDiversityPenalty(3), 28)
  assert.equal(domainDiversityPenalty(20), 28)
})
