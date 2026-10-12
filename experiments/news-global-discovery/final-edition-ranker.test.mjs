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
