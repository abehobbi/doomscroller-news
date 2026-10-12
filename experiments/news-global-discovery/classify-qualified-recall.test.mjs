import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyQualifiedRecall } from './classify-qualified-recall.mjs'

const event = (title, lane = 'world-major') => ({ representative: { selection: { assignedLane: lane }, snapshot: { title } } })

test('qualified recall distinguishes updates, blocked recoveries, and new events', () => {
  const qualified = { events: [event('Riyadh airport hit by second missile attack'), event('Roman fort discovered in Wales'), event('New labour law passes parliament')] }
  const edition = { cards: [{ eventId: 'ready', headline: 'Second missile attack hits Riyadh airport' }] }
  const blocked = { blocked: [{ eventId: 'blocked', headline: 'Roman fort discovered in Wales' }] }
  const result = classifyQualifiedRecall(qualified, edition, blocked)
  assert.deepEqual(result.counts, { 'new-event-candidate': 1, 'existing-event-update': 1, 'blocked-story-recovery': 1 })
})
