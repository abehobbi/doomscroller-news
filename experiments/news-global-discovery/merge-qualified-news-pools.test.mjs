import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeQualifiedReports } from './merge-qualified-news-pools.mjs'

function member(id, title, lane = 'world-major') {
  return {
    selection: { id, assignedLane: lane, poolScore: 90, representative: { title, priorityRegions: [], url: `https://example.com/${id}` } },
    snapshot: { title, finalUrl: `https://example.com/${id}`, sourceUrl: `https://example.com/${id}`, publisher: `${id}.example`, publishedAt: '2026-10-10T00:00:00Z', evidenceText: `${title}. Confirmed details about this event.`, evidenceChars: 500, imageUrl: 'https://example.com/image.jpg' },
    eligible: true,
    rejectionReasons: [],
  }
}

const cluster = value => ({ members: [value], representative: value, lanes: [value.selection.assignedLane], independentSourceCount: 1, corroborationStatus: 'single-source-attributed' })

test('combined pool deduplicates source pages and lets recovered events compete', () => {
  const shared = member('shared', 'Major earthquake damages buildings in Panama')
  const recovered = member('recovered', 'Canada loses 68,000 jobs in September', 'priority-major')
  const report = mergeQualifiedReports([
    { events: [cluster(shared)], qualifiedButNotSelected: [] },
    { events: [cluster(shared), cluster(recovered)], qualifiedButNotSelected: [] },
  ], 10)
  assert.equal(report.inputMembers, 2)
  assert.equal(report.mergedEvents, 2)
  assert.ok(report.events.some(event => event.representative.selection.id === 'recovered'))
})
