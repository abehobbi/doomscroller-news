import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareRecallShortlist } from './prepare-qualified-recall-verification.mjs'

test('verification shortlist contains only genuinely new recall candidates and preserves sources', () => {
  const event = { selectionScore: 99, representative: { selection: { representative: { priorityRegions: ['Ghana'] } }, snapshot: { title: 'New event', finalUrl: 'https://example.com/new', publishedAt: '2026-10-12T00:00:00Z' } }, members: [] }
  const output = prepareRecallShortlist({ results: [{ disposition: 'new-event-candidate', title: 'New event', lane: 'priority-major', event }, { disposition: 'existing-event-update', title: 'Update', lane: 'world-major', event }] })
  assert.equal(output.selections.length, 1)
  assert.equal(output.selections[0].assignedLane, 'priority-major')
  assert.deepEqual(output.selections[0].representative.priorityRegions, ['Ghana'])
  assert.equal(output.selections[0].members.length, 0)
})
