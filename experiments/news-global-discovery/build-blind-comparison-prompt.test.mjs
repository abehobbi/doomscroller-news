import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBlindComparisonPrompt } from './build-blind-comparison-prompt.mjs'

test('blind comparison prompt preserves the exact run window and product constraints', () => {
  const prompt = buildBlindComparisonPrompt({ requestedWindow: { start: '2026-10-24T01:02:03.000Z', end: '2026-10-25T01:02:03.000Z' } })
  assert.match(prompt, /2026-10-24T01:02:03\.000Z/)
  assert.match(prompt, /2026-10-25T01:02:03\.000Z/)
  assert.match(prompt, /at least 30/)
  assert.match(prompt, /never more than 65/)
  assert.match(prompt, /Do not use or infer anything from another proposed edition/)
  assert.match(prompt, /Syria.*Middle East.*Bangladesh.*Ghana.*Canada/s)
})

test('blind comparison prompt refuses an unknown cutoff', () => {
  assert.throws(() => buildBlindComparisonPrompt({}), /requestedWindow/)
})
