import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceMatchesTitle, explicitReportingPeriodEnd, independentSourceGroups, isTrustedDomain, readiness, sourceFreshness } from './verify-unified-shortlist.mjs'

test('vetted specialist science publishers satisfy the trusted-source gate', () => {
  assert.equal(isTrustedDomain('skyatnightmagazine.com'), true)
  assert.equal(isTrustedDomain('psypost.org'), true)
  assert.equal(isTrustedDomain('scitechupdates.com'), false)
})

test('source evidence must overlap the selected event', () => {
  assert.equal(evidenceMatchesTitle('Riyadh airport hit by missile attack', 'A missile struck the Riyadh international airport during the attack.').passes, true)
  assert.equal(evidenceMatchesTitle('Riyadh airport hit by missile attack', 'A museum opened an exhibition about ancient pottery.').passes, false)
})

test('an explicit old reporting period cannot masquerade as fresh publication', () => {
  assert.equal(explicitReportingPeriodEnd('Reporting Period: 26 August – 3 October 2026', 2026), '2026-10-03T23:59:59.000Z')
  const result = sourceFreshness({ candidatePublishedAt: '2026-10-11T12:00:00Z', title: 'Flood update (Reporting Period: 26 August – 3 October 2026)', evidenceText: '', windowStart: '2026-10-09T00:00:00Z', referenceYear: 2026 })
  assert.equal(result.fresh, false)
  assert.match(result.reason, /reporting period ended/)
})

test('high-risk events require independent families and every ready card needs an image', () => {
  const selection = { representative: { title: 'Missile attack kills civilians' } }
  const source = { accepted: true, trusted: true, family: 'one', imageUrl: 'https://example.com/image.jpg', url: 'https://example.com/story', domain: 'example.com' }
  assert.equal(readiness(selection, [source]).ready, false)
  assert.match(readiness(selection, [source]).reasons.join(' '), /two independent/)
  assert.equal(readiness(selection, [source, { ...source, family: 'two' }]).ready, true)
})

test('casualty and disaster wording cannot bypass high-risk corroboration', () => {
  const source = { accepted: true, trusted: true, family: 'publisher-a', imageUrl: 'https://example.com/image.jpg', url: 'https://example.com/story', domain: 'example.com' }
  for (const title of ['Storm causes four deaths', 'Hurricane reaches the coast', 'Flood affects two million people']) {
    const result = readiness({ representative: { title } }, [source])
    assert.equal(result.highRisk, true)
    assert.equal(result.ready, false)
    assert.ok(result.reasons.includes('high-risk event lacks two independent source families'))
  }
})

test('copied wire text counts as one independent source even when a republication omits the byline', () => {
  const common = 'Standing knee deep in the river, residents said the government project flooded homes and temples without providing enough compensation to rebuild their lives. The dispute is an early test for an ambitious national plan to link rivers and redistribute water to drought prone regions.'
  const sources = [
    { accepted: true, trusted: true, family: 'wire:reuters', evidenceText: common },
    { accepted: true, trusted: true, family: 'publisher:copy.example', evidenceText: `${common} Critics said the programme risks uprooting communities.` },
  ]
  assert.equal(independentSourceGroups(sources).length, 1)
})
