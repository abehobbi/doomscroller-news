import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTavilyDiscoveryReport, candidateRejectionReason, TAVILY_COMPLEMENTARY_QUERIES } from './tavily-complementary-scout.mjs'

test('complementary Tavily discovery uses eight distinct basic-credit roles', () => {
  assert.equal(TAVILY_COMPLEMENTARY_QUERIES.length, 8)
  assert.equal(new Set(TAVILY_COMPLEMENTARY_QUERIES.map(item => item.role)).size, 8)
  assert.deepEqual(new Set(TAVILY_COMPLEMENTARY_QUERIES.map(item => item.lane)), new Set(['world-major', 'priority-major', 'priority-interesting', 'world-interesting', 'discovery']))
  assert.ok(TAVILY_COMPLEMENTARY_QUERIES.every(item => /not |exclude|prefer /i.test(item.query)))
})

test('Tavily discovery normalizes duplicate URLs into the existing candidate shape', () => {
  const report = buildTavilyDiscoveryReport([
    { id: 'a', lane: 'world-major', creditsUsed: 1, results: [{ title: 'A major event', url: 'https://example.com/a?utm_source=x', published_date: '2026-10-21' }] },
    { id: 'b', lane: 'world-interesting', creditsUsed: 1, results: [{ title: 'A major event', url: 'https://example.com/a', published_date: '2026-10-21' }] },
  ], { start: '2026-10-18', end: '2026-10-21' })
  assert.equal(report.provider, 'tavily'); assert.equal(report.creditsUsed, 2); assert.equal(report.uniqueCandidateCount, 1)
  assert.deepEqual(report.candidates[0].lanes, ['world-major', 'world-interesting'])
})

test('Tavily drops non-article result shapes before they consume shortlist space', () => {
  const results = [
    { title: 'Ministry of Lands Housing and Country Planning', url: 'https://example.gov/' },
    { title: 'Company presents new pivotal trial data', url: 'https://example.com/releases/1' },
    { title: 'Residents restore a century-old neighbourhood market', url: 'https://local.example/news/market-restoration' },
    { title: 'Witness describes the harbour rescue', url: 'https://station.example/video/news/rescue/42' },
  ]
  assert.equal(candidateRejectionReason(results[0]), 'generic-index-title')
  assert.equal(candidateRejectionReason(results[1]), 'promotional-or-press-release')
  assert.equal(candidateRejectionReason(results[2]), null)
  assert.equal(candidateRejectionReason(results[3]), 'video-only-result')

  const report = buildTavilyDiscoveryReport([{ id: 'local', lane: 'world-interesting', creditsUsed: 1, results }], { start: '2026-10-18', end: '2026-10-21' })
  assert.equal(report.rawResultCount, 4)
  assert.equal(report.rejectedCandidateCount, 3)
  assert.equal(report.uniqueCandidateCount, 1)
  assert.deepEqual(report.rejectionCounts, { 'generic-index-title': 1, 'promotional-or-press-release': 1, 'video-only-result': 1 })
})
