import assert from 'node:assert/strict'
import test from 'node:test'
import { auditDailyShadowReadiness, DAILY_LANE_MINIMUMS } from './audit-daily-shadow-readiness.mjs'

const cards = Object.entries(DAILY_LANE_MINIMUMS).flatMap(([lane, count]) => Array.from({ length: count }, (_, index) => ({
  lane, headline: `${lane} worthwhile event number ${index + 1}`, primaryUrl: `https://example.com/${lane}/${index}`,
  sources: [{ url: `https://example.com/${lane}/${index}` }], image: { url: `https://example.com/${lane}/${index}.jpg` },
})))
const laneCounts = Object.fromEntries(Object.entries(DAILY_LANE_MINIMUMS))
const discovery = { requestedWindow: { start: '2026-10-24T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z' } }

test('a balanced source-complete 24-hour edition earns strong daily success', () => {
  const result = auditDailyShadowReadiness({ cards, audit: { laneCounts } }, discovery, { safeForDailyFullRun: true })
  assert.equal(result.totalCards, 38)
  assert.equal(result.viableDailyEdition, true)
  assert.equal(result.strongDailySuccess, true)
})

test('thirty cards cannot hide category deficits or a three-day window', () => {
  const result = auditDailyShadowReadiness({ cards: cards.slice(0, 30), audit: { laneCounts: { 'world-major': 10, 'priority-major': 8, 'world-interesting': 10, 'priority-interesting': 2, discovery: 0 } } }, { requestedWindow: { start: '2026-10-22T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z' } }, { safeForDailyFullRun: true })
  assert.equal(result.viableDailyEdition, false)
  assert.equal(result.strongDailySuccess, false)
  assert.deepEqual(result.laneGaps, { 'priority-interesting': 4, discovery: 4 })
})

test('a category over its product maximum cannot earn strong daily success', () => {
  const laneCounts = { 'world-major': 10, 'priority-major': 8, 'world-interesting': 10, 'priority-interesting': 6, discovery: 9 }
  const cards = Array.from({ length: 43 }, (_, index) => ({ headline: `Complete headline ${index}`, primaryUrl: `https://example.com/${index}`, sources: [{ url: `https://example.com/${index}` }], image: { url: `https://example.com/${index}.jpg` } }))
  const result = auditDailyShadowReadiness({ cards, audit: { laneCounts } }, { requestedWindow: { start: '2026-10-25T00:00:00Z', end: '2026-10-26T00:00:00Z' } }, { safeForDailyFullRun: true })
  assert.equal(result.checks.categoryMaximums, false)
  assert.deepEqual(result.laneOverages, { discovery: 1 })
  assert.equal(result.strongDailySuccess, false)
})
