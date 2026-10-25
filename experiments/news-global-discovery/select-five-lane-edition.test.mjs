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

test('equivalent investment amounts in different currencies do not split one event', () => {
  assert.equal(candidatesDescribeSameThread(
    { title: "Japan to invest approximately Tk 774.7 billion in Bangladesh's private sector" },
    { title: 'Japan to arrange $6.35 billion in private investment for Bangladesh' },
  ), true)
})

test('different disease outbreaks in different countries never become one event thread', () => {
  assert.equal(candidatesDescribeSameThread(
    { title: 'Measles death toll in Bangladesh reaches 1,196 after 7 more children die' },
    { title: 'Congo Ebola outbreak spreads as more children die' },
  ), false)
})

test('multi-event news roundups cannot absorb separate regional stories', () => {
  const roundup = { title: 'Attack in the West Bank kills 2 Israeli soldiers, and other Mideast news' }
  assert.equal(candidatesDescribeSameThread(
    roundup,
    { title: 'Protests erupt across Syria after Israeli forces kill man with Down syndrome' },
  ), false)
  assert.equal(candidatesDescribeSameThread(
    roundup,
    { title: 'Migrant workers find strength amid Israeli strikes in Lebanon' },
  ), false)
  assert.equal(candidatesDescribeSameThread(
    roundup,
    { title: 'World News in Brief: UN team tours the West Bank and Russian attacks intensify' },
  ), false)
  assert.ok(scoreCandidate(candidate(roundup.title, ['priority-major'], ['Middle East']), '2026-10-23T10:00:00Z').score < 0)
  assert.equal(candidatesDescribeSameThread(
    { title: 'Protests erupt across Syria after Israeli forces kill man with Down syndrome' },
    { title: 'Israel launches collective punishment campaign in Hebron after two soldiers killed' },
  ), false)
  assert.equal(candidatesDescribeSameThread(
    { title: 'Protests erupt across Syria after Israeli forces kill man with Down syndrome' },
    { title: 'Residents protest Israeli incursions in Quneitra' },
  ), true)
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
  assert.equal(lowConsequenceEvent('Ghana signs $28 billion agreement for petroleum hub expansion in Jomoro'), true)
  assert.equal(lowConsequenceEvent('PHDC signs $28bn deal for second phase of Ghana petroleum hub'), true)
  assert.equal(lowConsequenceEvent('Ghana signs $28bn Petroleum Hub deal for a planned refinery'), true)
  assert.equal(lowConsequenceEvent('Church to open global education centre in Accra next year'), true)
  assert.equal(lowConsequenceEvent('Ghana partnership releases funding and construction begins on petroleum hub'), false)
  assert.ok(scoreCandidate(candidate('Consulate to launch property expo next month', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('Habitat Fair closes with fun and big sales', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('Club suffers first defeat as rivals return to winning ways', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').score < 0)
  assert.ok(scoreCandidate(candidate('IMF signs agreement over holding annual meetings in capital', ['priority-interesting']), '2026-10-13T10:00:00Z').score < 0)
})

test('calls for implementation and outlined investments remain statement-only', () => {
  assert.equal(lowConsequenceEvent('Qatar and France call for Gaza ceasefire implementation and freedom of navigation'), true)
  assert.equal(lowConsequenceEvent('Minister outlines $270 million AI investment plan'), true)
  assert.equal(lowConsequenceEvent('Government releases approved funding and construction begins'), false)
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
