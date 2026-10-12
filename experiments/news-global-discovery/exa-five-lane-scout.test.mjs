import assert from 'node:assert/strict'
import test from 'node:test'
import { selectedQueries } from './exa-five-lane-scout.mjs'

test('lane filter supports exact deficit discovery without unrelated searches', () => {
  const selected = selectedQueries('all', ['world-major', 'priority-major', 'discovery'])
  assert.equal(selected.length, 16)
  assert.deepEqual([...new Set(selected.map(query => query.lane))], ['world-major', 'priority-major', 'discovery'])
})

test('lane filter still respects the requested scan family', () => {
  assert.equal(selectedQueries('major', ['discovery']).length, 0)
  assert.equal(selectedQueries('depth', ['discovery']).length, 4)
})
