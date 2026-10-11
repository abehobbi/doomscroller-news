import assert from 'node:assert/strict'
import test from 'node:test'
import { auditFinalCandidates } from './audit-final-candidate-readiness.mjs'

function candidate({ sources = 2, image = 'https://example.com/image.jpg', publisher = 'bbc.com' } = {}) {
  const member = index => ({ snapshot: { title: 'A concrete event headline with enough context', evidenceText: 'Officials documented a specific recent development affecting local residents. The report identifies the people involved and explains the immediate consequence. A second complete paragraph provides enough factual context for a grounded summary.', evidenceChars: 230, publisher: index ? `support${index}.com` : publisher, finalUrl: `https://${index ? `support${index}.com` : publisher}/story`, publishedAt: '2026-10-11T00:00:00Z', imageUrl: index ? null : image }, selection: { representative: { priorityRegions: [] } } })
  const members = Array.from({ length: sources }, (_, index) => member(index))
  return { eventId: 'event', rank: 1, lane: 'world-major', headline: members[0].snapshot.title, event: { representative: members[0], members, independentSourceCount: sources } }
}

test('corroborated candidate with evidence and image is writer-ready', () => {
  const report = auditFinalCandidates({ selected: [candidate()] })
  assert.equal(report.readyCount, 1)
  assert.equal(report.repairCount, 0)
})

test('single-source risky candidate enters source-repair queue', () => {
  const report = auditFinalCandidates({ selected: [candidate({ sources: 1, publisher: 'unknown.example' })] })
  assert.equal(report.readyCount, 0)
  assert.equal(report.repairCount, 1)
  assert.equal(report.verificationQueue.length, 1)
})

test('missing image is a non-source blocker', () => {
  const report = auditFinalCandidates({ selected: [candidate({ image: null })] })
  assert.equal(report.withheldCount, 1)
  assert.match(report.withheld[0].blockers.join(' '), /no publisher image/)
})
