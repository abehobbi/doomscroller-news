import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTavilyDiscoveryReport, TAVILY_COMPLEMENTARY_QUERIES } from './tavily-complementary-scout.mjs'

test('complementary Tavily discovery is fixed at five basic-credit searches', () => {
  assert.equal(TAVILY_COMPLEMENTARY_QUERIES.length, 5)
  assert.deepEqual(new Set(TAVILY_COMPLEMENTARY_QUERIES.map(item => item.lane)), new Set(['world-major', 'priority-major', 'world-interesting', 'discovery']))
})

test('Tavily discovery normalizes duplicate URLs into the existing candidate shape', () => {
  const report = buildTavilyDiscoveryReport([
    { id: 'a', lane: 'world-major', creditsUsed: 1, results: [{ title: 'A major event', url: 'https://example.com/a?utm_source=x', published_date: '2026-10-21' }] },
    { id: 'b', lane: 'world-interesting', creditsUsed: 1, results: [{ title: 'A major event', url: 'https://example.com/a', published_date: '2026-10-21' }] },
  ], { start: '2026-10-18', end: '2026-10-21' })
  assert.equal(report.provider, 'tavily'); assert.equal(report.creditsUsed, 2); assert.equal(report.uniqueCandidateCount, 1)
  assert.deepEqual(report.candidates[0].lanes, ['world-major', 'world-interesting'])
})
