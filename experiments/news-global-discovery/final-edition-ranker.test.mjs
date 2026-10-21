import test from 'node:test'
import assert from 'node:assert/strict'
import { rankFrontPage, scoreFrontPageCard } from './final-edition-ranker.mjs'

const card = (headline, lane, text = '') => ({ headline, lane, pages: [{ text }] })

test('mass-casualty breaking news outranks prospective major news and interesting cards', () => {
  const ranked = rankFrontPage([
    card('Syria considers military assistance for Saudi Arabia', 'priority-major', 'Officials are weighing options.'),
    card('Traditional craft changes in one town', 'world-interesting', 'Local artisans described the change.'),
    card('Attack on Riyadh airport leaves 12 dead and 309 injured', 'world-major', 'The airport suspended operations after a drone attack.'),
  ])
  assert.equal(ranked[0].headline, 'Attack on Riyadh airport leaves 12 dead and 309 injured')
  assert.equal(ranked.at(-1).lane, 'world-interesting')
})

test('large current disaster outranks a major protest when both qualify', () => {
  const ranked = rankFrontPage([
    card("Protesters demand resignation of India's election chief", 'world-major', 'Hundreds were detained during the protest.'),
    card('At least 44 people dead and more than one million affected by floods', 'priority-major', 'The floods stranded 267,918 families.'),
  ])
  assert.match(ranked[0].headline, /44 people dead/)
})

test('mass hunger affecting millions receives large-human-scale priority', () => {
  const score = scoreFrontPageCard(card('Nearly 16 million Afghans face crisis-level hunger', 'world-major', 'The food emergency is worsening before winter.'))
  assert.match(score.reasons.join(' '), /large directly affected population/)
})

test('small casualty count does not automatically outrank interstate escalation risk', () => {
  const ranked = rankFrontPage([
    { eventId: 'family', lane: 'world-major', headline: 'Strike kills three members of one family', pages: [{ text: 'The strike killed 3 people.' }] },
    { eventId: 'war-risk', lane: 'world-major', headline: 'Countries exchange invasion accusations as troops cross border', pages: [{ text: 'Officials warned that the military escalation could spread.' }] },
  ])
  assert.equal(ranked[0].eventId, 'war-risk')
})

test('anniversary framing does not receive the same immediacy as a breaking casualty event', () => {
  const anniversary = scoreFrontPageCard(card('Humanitarian groups report violence one year after ceasefire', 'world-major', 'Groups reported cumulative deaths.'))
  const breaking = scoreFrontPageCard(card('Strike kills 25 people in city', 'world-major', 'The attack occurred today.'))
  assert.ok(breaking.score > anniversary.score)
})

test('a year after framing is treated as retrospective', () => {
  const score = scoreFrontPageCard(card('A year after ceasefire deal, families still wait for relief', 'priority-major', 'The report reviews conditions since an attack killed 300 people and displaced thousands.'))
  assert.match(score.reasons.join(' '), /retrospective/)
  assert.doesNotMatch(score.reasons.join(' '), /immediate casualties|security escalation|large directly affected/)
})

test('historical language cannot accidentally promote an Interesting card above Major news', () => {
  const ranked = rankFrontPage([
    card('Research adds Polish codebreakers to wartime roll of honour', 'world-interesting', 'The 103-year-old veteran trained with troops during the war.'),
    card('Bangladesh signs major port operating agreement', 'priority-major', 'The agreement affects the country’s largest port.'),
  ])
  assert.equal(ranked[0].lane, 'priority-major')
})

test('buried cumulative casualty totals do not outrank the fresh event toll', () => {
  const current = { headline: 'Attack kills four people', lane: 'world-major', pages: [{ text: 'Four people were killed in the fresh attack. Authorities are investigating the incident. Later background says 100,000 people have died during the wider war.' }] }
  const larger = { headline: 'Airport attack kills 13 people', lane: 'priority-major', pages: [{ text: 'The missile attack killed 13 people and injured more than 300 at the airport.' }] }
  const ranked = rankFrontPage([current, larger])
  assert.equal(ranked[0].headline, larger.headline)
  assert.doesNotMatch(ranked[1].frontPageRanking.reasons.join(' '), /100000 explicitly reported/)
})

test('an actual missile attack outranks a strategy for a potential invasion', () => {
  const ranked = rankFrontPage([
    card('NATO commander unveils strategy to counter potential Russian invasion', 'world-major', 'The strategy describes how NATO could respond.'),
    card('Russian ballistic missiles strike Kyiv, hitting civilian infrastructure', 'world-major', 'Several missiles struck the city after delayed air raid alerts.'),
  ])
  assert.match(ranked[0].headline, /missiles strike Kyiv/)
  assert.match(ranked[1].frontPageRanking.reasons.join(' '), /prospective/)
})

test('plural attack wording and kill-at-least casualty phrasing receive urgency credit', () => {
  const ranked = rankFrontPage([
    card('NATO commander unveils strategy to counter Russian attacks', 'world-major', 'The plan describes a possible future response.'),
    card('Russian attacks kill at least 10 and injure dozens across Ukraine', 'world-major', 'The attacks hit civilian areas.'),
  ])
  assert.match(ranked[0].headline, /kill at least 10/)
  assert.match(ranked[0].frontPageRanking.reasons.join(' '), /immediate casualties \(10 explicitly reported\)/)
})
