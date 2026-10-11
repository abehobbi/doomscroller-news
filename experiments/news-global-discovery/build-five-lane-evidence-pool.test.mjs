import test from 'node:test'
import assert from 'node:assert/strict'
import { perQueryTargetForLane } from './build-five-lane-evidence-pool.mjs'

test('major searches preserve more candidates before evidence validation', () => {
  const options = { perQuery: 5, perMajorQuery: 10 }
  assert.equal(perQueryTargetForLane('world-major', options), 10)
  assert.equal(perQueryTargetForLane('priority-major', options), 10)
  assert.equal(perQueryTargetForLane('world-interesting', options), 5)
  assert.equal(perQueryTargetForLane('priority-interesting', options), 5)
  assert.equal(perQueryTargetForLane('discovery', options), 5)
})
