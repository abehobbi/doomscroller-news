import assert from 'node:assert/strict'
import test from 'node:test'
import { candidatesDescribeSameThread, lowConsequenceEvent, scoreCandidate } from './select-five-lane-edition.mjs'

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

test('shared amounts do not merge unrelated science and public spending stories', () => {
  const fossil = { title: 'The fossil record may be missing 200 million years of animal history' }
  const hospital = { title: 'Ghana allocates 200 million cedis for police hospital expansion' }
  assert.equal(candidatesDescribeSameThread(fossil, hospital), false)
})

test('generic statements and ceremonial partnerships cannot fill an edition', () => {
  assert.equal(lowConsequenceEvent('President urges churches to provide practical community service'), true)
  assert.equal(lowConsequenceEvent('Watch company partners with school for 150th anniversary'), true)
  assert.equal(lowConsequenceEvent('Saudi Arabia reaffirms support for refugee returns'), true)
  assert.equal(lowConsequenceEvent('Government signs agreement funding 49 school repairs'), false)
  assert.equal(scoreCandidate(candidate('Prime minister showcases country at annual meeting', ['priority-interesting'], ['Ghana']), '2026-10-13T10:00:00Z').lowConsequence, true)
})
