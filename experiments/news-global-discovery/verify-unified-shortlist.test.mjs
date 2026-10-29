import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceMatchesTitle, explicitReportingPeriodEnd, independentSourceGroups, isTrustedDomain, readiness, sourceFreshness, usablePublisherImageUrl } from './verify-unified-shortlist.mjs'

test('vetted specialist science publishers satisfy the trusted-source gate', () => {
  assert.equal(isTrustedDomain('skyatnightmagazine.com'), true)
  assert.equal(isTrustedDomain('psypost.org'), true)
  assert.equal(isTrustedDomain('scitechupdates.com'), false)
})

test('author avatars cannot satisfy the publisher-image requirement', () => {
  assert.equal(usablePublisherImageUrl('https://secure.gravatar.com/avatar/abc?s=96'), false)
  assert.equal(usablePublisherImageUrl('https://publisher.example/avatar/reporter.jpg'), false)
  assert.equal(usablePublisherImageUrl('https://publisher.example/news/train-crash.jpg'), true)
})

test('vetted regional and public-interest publishers satisfy the trusted-source gate', () => {
  for (const domain of ['rappler.com', 'tpr.org', 'canadiangeographic.ca', '3news.com', 'cebudailynews.inquirer.net', 'knust.edu.gh', 'adb.org']) {
    assert.equal(isTrustedDomain(domain), true, domain)
  }
  assert.equal(isTrustedDomain('unknown-regional-blog.example'), false)
})

test('source evidence must overlap the selected event', () => {
  assert.equal(evidenceMatchesTitle('Riyadh airport hit by missile attack', 'A missile struck the Riyadh international airport during the attack.').passes, true)
  assert.equal(evidenceMatchesTitle('Riyadh airport hit by missile attack', 'A museum opened an exhibition about ancient pottery.').passes, false)
})

test('generic election and violence terms cannot corroborate different events', () => {
  assert.equal(evidenceMatchesTitle(
    'Mississauga mayoral election 2026: Where candidates stand on key issues',
    'Toronto mayoral candidate Brad Bradford outlines his plans ahead of the 2026 election.',
  ).passes, false)
  assert.equal(evidenceMatchesTitle(
    'Former Conservative candidate Jack Ross suspended over alleged contract killing discussions',
    'Ivory Coast charged 12 people over a gendarme killing amid lingering election tensions.',
  ).passes, false)
  assert.equal(evidenceMatchesTitle(
    'Former Tory election candidate suspended over contract killing claims',
    'Ivory Coast: 12 charged over a gendarme killing amid lingering election tensions.',
  ).passes, false)
  assert.equal(evidenceMatchesTitle(
    'Mississauga mayoral election 2026: Where candidates stand on key issues',
    'Mississauga voters will choose among mayoral candidates debating housing and transit issues.',
  ).passes, true)
})

test('a different named location cannot corroborate a generic attack headline', () => {
  const result = evidenceMatchesTitle(
    'Drone attack on market in Abyei, Sudan kills at least 153',
    'Russian drone attack kills two in Kyiv, Ukraine\nTwo people were killed when a drone struck a residential building in Kyiv.',
  )
  assert.equal(result.passes, false)
  assert.equal(result.explicitConflict, true)
})

test('Arabic headlines match Arabic article evidence and the Arabic Al Jazeera domain is trusted', () => {
  const title = 'حرف حلب التراثية تقاوم الاندثار وتستعيد بريقها بلمسات معاصرة'
  const evidence = 'اختتم في مدينة حلب السورية معرض المهن الحرفية والتراثية القديمة بهدف الحفاظ على الحرف المهددة بالاندثار وتطويرها بلمسات معاصرة.'
  assert.equal(evidenceMatchesTitle(title, evidence).passes, true)
  assert.equal(isTrustedDomain('aljazeera.net'), true)
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
  for (const title of ['Storm causes four deaths', 'Hurricane reaches the coast', 'Flood affects two million people', 'Russian attacks kill 10 people']) {
    const result = readiness({ representative: { title } }, [source])
    assert.equal(result.highRisk, true)
    assert.equal(result.ready, false)
    assert.ok(result.reasons.includes('high-risk event lacks two independent trusted source families'))
  }
})

test('contested political evidence cannot bypass corroboration through a neutral headline', () => {
  const source = {
    accepted: true, trusted: true, family: 'publisher-a', imageUrl: 'https://example.com/image.jpg',
    url: 'https://example.com/story', domain: 'example.com', title: 'Voters demand an explanation',
    evidenceText: 'The report covers an election-roll dispute, protests and allegations that voters were disenfranchised.',
  }
  const result = readiness({ representative: { title: 'Millions of names removed from national voter rolls' } }, [source])
  assert.equal(result.highRisk, true)
  assert.equal(result.ready, false)
  assert.ok(result.reasons.includes('high-risk event lacks two independent trusted source families'))
})

test('ordinary civic reporting is not made high-risk by incidental article vocabulary', () => {
  const source = {
    accepted: true, trusted: true, family: 'publisher-a', imageUrl: 'https://example.com/image.jpg',
    url: 'https://example.com/story', domain: 'example.com', title: 'Olivia Chow wins Toronto mayoral election',
    evidenceText: 'Police managed traffic near the court while a protest elsewhere in the city ended peacefully.',
  }
  const result = readiness({ representative: { title: source.title } }, [source])
  assert.equal(result.highRisk, false)
  assert.equal(result.ready, true)
})

test('animal language inside discovery evidence does not turn peer-reviewed research into a conflict event', () => {
  const source = {
    accepted: true, trusted: true, family: 'publisher:bbc.com', imageUrl: 'https://example.com/fossil.jpg',
    url: 'https://bbc.com/fossil', domain: 'bbc.com', title: 'Isle of Wight fossil identified as new dinosaur species',
    evidenceText: 'Researchers found a new megaraptoran. Its relatives attacked prey with their long arms and giant claws.',
  }
  const result = readiness({ assignedLane: 'discovery', representative: { title: source.title } }, [source])
  assert.equal(result.highRisk, false)
  assert.equal(result.ready, true)
})

test('copied wire text counts as one independent source even when a republication omits the byline', () => {
  const common = 'Standing knee deep in the river, residents said the government project flooded homes and temples without providing enough compensation to rebuild their lives. The dispute is an early test for an ambitious national plan to link rivers and redistribute water to drought prone regions.'
  const sources = [
    { accepted: true, trusted: true, family: 'wire:reuters', evidenceText: common },
    { accepted: true, trusted: true, family: 'publisher:copy.example', evidenceText: `${common} Critics said the programme risks uprooting communities.` },
  ]
  assert.equal(independentSourceGroups(sources).length, 1)
})
