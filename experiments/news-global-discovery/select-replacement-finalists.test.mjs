import assert from 'node:assert/strict'
import test from 'node:test'

import { selectReplacementFinalists } from './select-replacement-finalists.mjs'

const card = (headline, lane, regions = [], sources = 1) => ({ headline, lane, priorityRegions: regions, primaryUrl: `https://example.com/${headline}`, acceptedSources: Array.from({ length: sources }, (_, index) => ({ accepted: true, family: `publisher:${index}`, domain: `${index}.example`, url: `https://${index}.example/${headline}`, evidenceText: `distinct evidence ${index}` })) })

test('fills exact lane and region gaps and prefers stronger independent sourcing', () => {
  const demand = { audit: { laneGaps: { 'world-major': 1, 'world-interesting': 1, 'priority-interesting': 2 }, regionGaps: { Syria: 1, Ghana: 1 } } }
  const audit = { cards: [card('major', 'world-major'), card('weak-interesting', 'world-interesting'), card('strong-interesting', 'world-interesting', [], 3), card('syria', 'priority-interesting', ['Syria']), card('ghana', 'priority-interesting', ['Ghana'])] }
  const output = selectReplacementFinalists([audit], demand)
  assert.equal(output.cards.length, 4)
  assert.ok(output.cards.some(item => item.headline === 'strong-interesting'))
  assert.deepEqual(output.audit.regionCounts, { Syria: 1, Ghana: 1 })
})

