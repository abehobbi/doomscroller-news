import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeRecallGate } from './summarize-recall-gate.mjs'

test('recall gate combines ready sources without double counting repaired events', () => {
  const ready = { eventId: 'a', headline: 'Joint Statement on policy', lane: 'world-major', readiness: { ready: true }, sources: [{ accepted: true, domain: 'example.com' }] }
  const repaired = { eventId: 'b', headline: 'Concrete event happens', lane: 'discovery', readiness: { ready: true }, sources: [{ accepted: true, domain: 'nature.com' }] }
  const blocked = { eventId: 'c', headline: 'Blocked', lane: 'world-major', readiness: { ready: false, reasons: ['missing source'] }, sources: [] }
  const output = summarizeRecallGate({ ready: [ready], repairQueue: [blocked] }, { results: [repaired, blocked] }, { audit: { laneCounts: { 'world-major': 7, discovery: 2 } } })
  assert.equal(output.readyForEditorialReview.length, 2)
  assert.equal(output.blocked.length, 1)
  assert.deepEqual(output.potentialLaneCounts, { 'world-major': 8, discovery: 3 })
  assert.ok(output.readyForEditorialReview[0].flags.length)
})
