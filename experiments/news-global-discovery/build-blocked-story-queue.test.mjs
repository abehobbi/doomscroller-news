import assert from 'node:assert/strict'
import test from 'node:test'
import { blockerCodes, buildBlockedStoryQueue, terminalRejection } from './build-blocked-story-queue.mjs'

test('inaccessible evidence remains promising but blocked rather than rejected', () => {
  const item = { eventId: 'study', headline: 'Useful new study', lane: 'discovery', selectionScore: 90, readiness: { ready: false, reasons: ['no accessible, relevant and fresh source evidence', 'no verified publisher image recovered'] }, sources: [] }
  assert.deepEqual(blockerCodes(item), ['evidence-inaccessible', 'image-missing'])
  assert.equal(terminalRejection(item), false)
  const result = buildBlockedStoryQueue({ repairQueue: [], rejected: [item] }, [], { cards: [] })
  assert.equal(result.blocked[0].status, 'promising-blocked')
  assert.equal(result.rejected.length, 0)
})

test('an explicitly stale report remains rejected', () => {
  const item = { eventId: 'old', headline: 'Old report', lane: 'world-major', selectionScore: 90, readiness: { ready: false, reasons: ['headline explicitly identifies a reporting period that ended before the edition window'] }, sources: [] }
  const result = buildBlockedStoryQueue({ repairQueue: [], rejected: [item] }, [], { cards: [] })
  assert.equal(result.blocked.length, 0)
  assert.equal(result.rejected[0].status, 'rejected')
})

test('selected and successfully repaired stories are absent from the blocked queue', () => {
  const base = id => ({ eventId: id, headline: id, lane: 'world-major', selectionScore: 90, readiness: { ready: false, reasons: ['no trusted or registered publisher source'] }, sources: [] })
  const repaired = { ...base('repaired'), readiness: { ready: true, reasons: [] } }
  const result = buildBlockedStoryQueue({ repairQueue: [base('selected'), base('repaired')], rejected: [] }, [{ results: [repaired] }], { cards: [{ eventId: 'selected' }] })
  assert.deepEqual(result, { blocked: [], rejected: [] })
})
