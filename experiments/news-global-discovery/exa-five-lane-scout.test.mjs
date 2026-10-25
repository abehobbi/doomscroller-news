import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetQueries, selectedQueries } from './exa-five-lane-scout.mjs'

test('lane filter supports exact deficit discovery without unrelated searches', () => {
  const selected = selectedQueries('all', ['world-major', 'priority-major', 'discovery'])
  assert.equal(selected.length, 16)
  assert.deepEqual([...new Set(selected.map(query => query.lane))], ['world-major', 'priority-major', 'discovery'])
})

test('bounded full scans retain every lane and priority region before adding depth', () => {
  const selected = budgetQueries(selectedQueries('full'), 12)
  assert.equal(selected.length, 12)
  assert.deepEqual(new Set(selected.map(query => query.lane)), new Set(['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']))
  for (const region of ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']) assert.ok(selected.some(query => query.region === region))
})

test('a daily breadth scan can inspect twenty ranked candidates per query without changing query count', () => {
  const queries = budgetQueries(selectedQueries('full'), 28)
  assert.equal(queries.length, 28)
  assert.ok(queries.every(query => query.id && query.lane))
})

test('lane filter still respects the requested scan family', () => {
  assert.equal(selectedQueries('major', ['discovery']).length, 0)
  assert.equal(selectedQueries('depth', ['discovery']).length, 4)
})
