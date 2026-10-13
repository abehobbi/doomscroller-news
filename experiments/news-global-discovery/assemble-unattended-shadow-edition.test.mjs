import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleUnattendedShadowEdition } from './assemble-unattended-shadow-edition.mjs'

const input = (eventId, lane, headline) => ({ eventId, lane, headline, publishedAt: '2026-10-12T12:00:00Z', priorityRegions: [], image: { url: `https://img.test/${eventId}.jpg`, publisher: 'img.test' }, primarySource: { url: `https://source.test/${eventId}` } })
const accepted = (eventId, lane, headline, text, url = `https://source.test/${eventId}`) => ({ eventId, lane, sourceTitle: headline, status: 'accepted', card: { headline, pages: [{ text }], uncertainties: [] }, sources: [{ publisher: 'source.test', url }], audits: { content: { valid: true } }, provider: { complete: true } })

test('assembles accepted cards and preserves deterministic rejections', () => {
  const shortlist = { selected: [input('a', 'world-major', 'Airport attack'), input('b', 'discovery', 'Fossil study')] }
  const report = { expected: 2, resultCount: 2, totalNeurons: 80, results: [accepted('a', 'world-major', 'Airport attack kills civilians', 'A missile attack killed civilians at an airport.'), { eventId: 'b', sourceTitle: 'Fossil study', status: 'rejected', provider: { complete: true }, audits: { numbers: { valid: false } } }] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.accepted, 1)
  assert.equal(edition.rejected.length, 1)
  assert.deepEqual(edition.rejected[0].failedChecks, ['numbers'])
  assert.equal(edition.requiresEditorialReview, true)
})

test('flags generated cards that share a canonical source URL', () => {
  const shortlist = { selected: [input('a', 'world-major', 'First event'), input('b', 'world-interesting', 'Second event')] }
  const shared = 'https://source.test/shared'
  const report = { expected: 2, resultCount: 2, totalNeurons: 90, results: [accepted('a', 'world-major', 'First event develops', 'One distinct development happened.', shared), accepted('b', 'world-interesting', 'Second event develops', 'Another distinct development happened.', shared)] }
  const edition = assembleUnattendedShadowEdition(report, shortlist)
  assert.equal(edition.overlaps.length, 1)
  assert.equal(edition.requiresEditorialReview, true)
})
