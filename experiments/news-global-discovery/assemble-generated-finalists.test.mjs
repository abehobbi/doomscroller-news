import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleGeneratedFinalists } from './assemble-generated-finalists.mjs'

test('accepted repair replaces a rejected original while repeated failures remain quarantined', () => {
  const original = { expected: 3, accepted: 1, rejected: 2, totalNeurons: 30, results: [
    { eventId: 'a', status: 'accepted', card: { headline: 'A' } },
    { eventId: 'b', status: 'rejected', card: { headline: 'B1' }, audits: { dates: { valid: false, unsupported_exact_dates: ['x'] } } },
    { eventId: 'c', status: 'rejected', card: { headline: 'C1' }, audits: { numbers: { valid: false, unsupportedNumbers: ['2'] } } },
  ] }
  const repair = { accepted: 1, rejected: 1, totalNeurons: 10, results: [
    { eventId: 'b', status: 'accepted', card: { headline: 'B2' } },
    { eventId: 'c', status: 'rejected', card: { headline: 'C2' }, audits: { numbers: { valid: false, unsupportedNumbers: ['4'] } } },
  ] }
  const edition = assembleGeneratedFinalists(original, repair)
  assert.equal(edition.acceptedCount, 2)
  assert.equal(edition.quarantinedCount, 1)
  assert.equal(edition.accepted[1].card.headline, 'B2')
  assert.equal(edition.accepted[1].generationPass, 'repair')
  assert.equal(edition.quarantined[0].generatedHeadline, 'C1')
  assert.equal(edition.totalNeurons, 40)
})
