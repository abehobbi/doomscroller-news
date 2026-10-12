import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeSources, pendingRepairCandidates, repairCandidates } from './repair-unified-shortlist.mjs'
import { isTrustedDomain } from './verify-unified-shortlist.mjs'

test('repair candidates are bounded and ordered by selection strength', () => {
  const report = { repairQueue: [
    { eventId: 'low', selectionScore: 20, readiness: { reasons: [] } },
    { eventId: 'stale', selectionScore: 99, readiness: { reasons: ['headline explicitly identifies a reporting period that ended before the edition window'] } },
    { eventId: 'high', selectionScore: 80, readiness: { reasons: [] } },
  ] }
  assert.deepEqual(repairCandidates(report, 1).map(item => item.eventId), ['high'])
})

test('source merging removes exact family and URL duplicates without hiding independent reports', () => {
  const source = domain => ({ domain, url: `https://${domain}/story` })
  const merged = mergeSources([source('bbc.com')], [source('bbc.com'), source('reuters.com')])
  assert.deepEqual(merged.map(item => item.domain), ['bbc.com', 'reuters.com'])
})

test('repair reassessment recognizes newly vetted publishers without another search', () => {
  assert.equal(isTrustedDomain('mbcradio.com'), true)
  assert.equal(isTrustedDomain('washingtonpost.com'), true)
})

test('checkpoint resume skips already completed repair candidates', () => {
  const candidates = [{ eventId: 'done' }, { eventId: 'pending' }]
  assert.deepEqual(pendingRepairCandidates(candidates, [{ eventId: 'done' }]), [{ eventId: 'pending' }])
})
