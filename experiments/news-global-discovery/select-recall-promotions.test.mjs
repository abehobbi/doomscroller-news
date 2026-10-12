import test from 'node:test'
import assert from 'node:assert/strict'
import { possibleThreadOverlap, selectRecallPromotions } from './select-recall-promotions.mjs'

test('recognizes place-event and named-institution overlap without matching geography alone', () => {
  assert.equal(possibleThreadOverlap('Riyadh airport struck by projectile', 'Riyadh airport hit after missile attack'), true)
  assert.equal(possibleThreadOverlap('ACLU statement on attack on ICC', 'US sanctions ICC'), true)
  assert.equal(possibleThreadOverlap('ACLU statement on attack on the International Criminal Court', 'US sanctions ICC'), true)
  assert.equal(possibleThreadOverlap('Syria issues first Aramco letter of credit', 'Syrian families seek detainee release'), false)
})

test('promotes only strong distinct newcomers and preserves other dispositions', () => {
  const result = selectRecallPromotions({ results: [
    { cohort: 'baseline', eventId: 'old', headline: 'Riyadh airport hit after missile attack' },
    { cohort: 'recall', eventId: 'good', headline: 'Roman fort found in Wales', lane: 'discovery', editorialScore: 100, evaluation: { recommendation: 'strong' } },
    { cohort: 'recall', eventId: 'overlap', headline: 'Riyadh airport struck by projectile', lane: 'priority-major', editorialScore: 90, evaluation: { recommendation: 'strong' } },
    { cohort: 'recall', eventId: 'reserve', headline: 'Useful secondary story', lane: 'world-major', editorialScore: 72, evaluation: { recommendation: 'possible' } },
    { cohort: 'recall', eventId: 'bad', headline: 'Routine statement', lane: 'world-major', editorialScore: 50, evaluation: { recommendation: 'reject' } },
  ] }, { results: [] })
  assert.deepEqual(result.promoted.map(item => item.eventId), ['good'])
  assert.deepEqual(result.overlapReview.map(item => item.eventId), ['overlap'])
  assert.deepEqual(result.reserve.map(item => item.eventId), ['reserve'])
  assert.deepEqual(result.rejected.map(item => item.eventId), ['bad'])
})
