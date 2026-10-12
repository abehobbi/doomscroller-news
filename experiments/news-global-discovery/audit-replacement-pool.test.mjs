import assert from 'node:assert/strict'
import test from 'node:test'

import { auditReplacementPool } from './audit-replacement-pool.mjs'

test('withholds exact-source and semantic cross-batch duplicates', () => {
  const prior = { results: [
    { eventId: 'old-1', status: 'accepted', sourceTitle: 'Bangladeshi pilgrim killed in Houthi missile strike at Riyadh airport', sources: [{ url: 'https://example.com/riyadh-victim' }], card: { headline: 'Bangladeshi pilgrim killed in Houthi missile strike at Riyadh airport', pages: [{ text: 'A Houthi missile hit Riyadh international airport, killing 13 people and injuring more than 300.' }] } },
    { eventId: 'old-2', status: 'accepted', sourceTitle: 'ICC sanctions', sources: [{ url: 'https://example.com/icc' }], card: { headline: 'Coalition condemns United States sanctions on International Criminal Court', pages: [] } },
  ] }
  const edition = { cards: [
    { eventId: 'new-1', headline: 'Saudi Arabia investigates how Houthi missile breached Riyadh airport defenses', primaryUrl: 'https://another.example/riyadh-probe', pages: [{ text: 'Saudi officials are investigating a missile attack on Riyadh international airport that killed 13 and wounded more than 300.' }], acceptedSources: [] },
    { eventId: 'new-2', headline: 'States urge protection of ICC from US sanctions', primaryUrl: 'https://example.com/icc', pages: [], acceptedSources: [] },
    { eventId: 'new-3', headline: 'Ghana farmers seek compensation for expressway land', primaryUrl: 'https://example.com/ghana', pages: [], acceptedSources: [] },
  ] }
  const output = auditReplacementPool(edition, prior)
  assert.equal(output.overlapCount, 2)
  assert.deepEqual(output.cards.map(card => card.eventId), ['new-3'])
})

