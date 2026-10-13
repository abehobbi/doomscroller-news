import assert from 'node:assert/strict'
import test from 'node:test'
import { auditBlockedOpportunities, blockedCategory } from './audit-blocked-opportunities.mjs'

const item = (eventId, score, reasons, extra = {}) => ({
  eventId, headline: eventId, lane: 'world-interesting', selectionScore: score,
  readiness: { ready: !reasons.length, reasons, trustedSourceFamilies: extra.trusted || 0, acceptedSourceCount: extra.accepted || 0 },
  ...extra,
})

test('classifies image-only, corroboration, evidence and freshness blockers separately', () => {
  assert.equal(blockedCategory(item('image', 130, ['no verified publisher image recovered'], { trusted: 1, accepted: 1, repair: { requestId: 'request-image' } })), 'image-exception-candidate')
  assert.equal(blockedCategory(item('unsearched-image', 150, ['no verified publisher image recovered'], { trusted: 1, accepted: 1 })), 'image-blocked')
  assert.equal(blockedCategory(item('corroboration', 130, ['high-risk event lacks two independent trusted source families'])), 'corroboration-blocked')
  assert.equal(blockedCategory(item('evidence', 130, ['no accessible, relevant and fresh source evidence'])), 'evidence-unavailable')
  assert.equal(blockedCategory(item('stale', 130, ['headline explicitly identifies a reporting period that ended before the edition window'])), 'freshness-blocked')
})

test('repair results replace original blockers and high-potential losses remain visible', () => {
  const verification = { ready: [], repairQueue: [item('rescued', 125, ['no trusted or registered publisher source']), item('lost', 120, ['no accessible, relevant and fresh source evidence'])], rejected: [] }
  const repair = { results: [{ ...item('rescued', 125, [], { trusted: 1, accepted: 1 }), repair: { requestId: 'req' } }] }
  const report = auditBlockedOpportunities(verification, repair)
  assert.equal(report.counts['rescued-by-source-repair'], 1)
  assert.deepEqual(report.highPotentialBlocked.map(value => value.eventId), ['lost'])
})
