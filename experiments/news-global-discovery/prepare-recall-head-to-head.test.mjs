import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRecallHeadToHead } from './prepare-recall-head-to-head.mjs'

const evidence = 'Officials announced the development on Sunday. The change affects thousands of people across the region. Independent records describe the concrete consequences in detail. Further implementation dates and verified figures were also supplied.'
const snapshot = title => ({ title, publishedAt: '2026-10-12T00:00:00Z', publisher: 'example.com', sourceUrl: `https://example.com/${title}`, evidenceText: evidence })

test('combines baseline and recall candidates without exposing cohort in blind ids', () => {
  const baseline = { cards: [{ eventId: 'old', headline: 'Old story', lane: 'world-major', pages: [{ text: evidence }], primaryUrl: 'https://old.example/story' }] }
  const recall = { events: [{ id: 'new', representative: { selection: { assignedLane: 'discovery', representative: { priorityRegions: [] } }, snapshot: snapshot('New finding') } }], qualifiedButNotSelected: [] }
  const result = prepareRecallHeadToHead(baseline, recall)
  assert.deepEqual(result.audit, { baselineInput: 1, recallInput: 1, compared: 2, excluded: 0 })
  assert.deepEqual(new Set(result.candidates.map(item => item.cohort)), new Set(['baseline', 'recall']))
  assert.ok(result.candidates.every(item => /^E\d{3}$/.test(item.blindId)))
})
