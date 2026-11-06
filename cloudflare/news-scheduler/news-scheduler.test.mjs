import assert from 'node:assert/strict'
import test from 'node:test'

import { dueEdition, editionAlreadyPublished } from './src/index.js'

test('Toronto morning dispatch works in standard and daylight time', () => {
  assert.deepEqual(dueEdition(new Date('2026-11-06T13:30:00Z')), {
    slot: 'morning', date: '2026-11-06', scan: 'full', windowHours: '24',
  })
  assert.equal(dueEdition(new Date('2026-07-06T12:30:00Z')).slot, 'morning')
})

test('Toronto evening dispatch and retry use the intended slots', () => {
  assert.equal(dueEdition(new Date('2026-11-07T01:30:00Z')).slot, 'evening')
  assert.equal(dueEdition(new Date('2026-11-07T01:45:00Z')).slot, 'evening')
  assert.equal(dueEdition(new Date('2026-11-07T01:15:00Z')), null)
})

test('a current edition suppresses its retry but not the next slot', () => {
  const morning = dueEdition(new Date('2026-11-06T13:45:00Z'))
  const evening = dueEdition(new Date('2026-11-07T01:45:00Z'))
  assert.equal(editionAlreadyPublished('2026-11-06T13:40:00Z', morning), true)
  assert.equal(editionAlreadyPublished('2026-11-06T13:40:00Z', evening), false)
  assert.equal(editionAlreadyPublished('2026-11-06T17:42:27Z', morning), true)
})
