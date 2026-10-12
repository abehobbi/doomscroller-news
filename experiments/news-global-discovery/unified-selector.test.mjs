import test from 'node:test'
import assert from 'node:assert/strict'
import { candidatesDescribeSameThread, clusterCandidates } from './select-five-lane-edition.mjs'

const candidate = title => ({ title, laneScores: { 'world-major': 60 }, score: 60 })

test('related reports about one Riyadh airport attack thread consolidate', () => {
  const first = candidate('Deadly attack on Riyadh Airport kills 12, injures more than 300')
  const update = candidate('Riyadh airport hit again after deadly Houthi missile attack')
  assert.equal(candidatesDescribeSameThread(first, update), true)
  assert.equal(clusterCandidates([first, update]).length, 1)
})

test('Saudi and Riyadh wording still resolves to one airport thread', () => {
  assert.equal(candidatesDescribeSameThread(
    candidate('Riyadh airport hit again after deadly missile attack'),
    candidate('Bangladeshis killed or injured in airport attack in Saudi Arabia'),
  ), true)
})

test('different attacks in different places do not merge from generic language alone', () => {
  const riyadh = candidate('Deadly attack on Riyadh Airport kills 12')
  const sudan = candidate('Drone attack on Sudan mine kills 72 workers')
  assert.equal(candidatesDescribeSameThread(riyadh, sudan), false)
})

test('minor wording variants do not split one casualty event', () => {
  assert.equal(candidatesDescribeSameThread(
    candidate('At least 72 Sudanese miners killed in air strike'),
    candidate('72 killed in airstrike on gold mine on Sudan-Egypt border'),
  ), true)
})

test('paraphrased coverage of one protest and one ceasefire thread consolidate', () => {
  assert.equal(candidatesDescribeSameThread(
    candidate("India's Cockroach movement leaders say fight has begun after Delhi protest"),
    candidate("India’s cockroach leaders vow to keep up election protests"),
  ), true)
  assert.equal(candidatesDescribeSameThread(
    candidate('Zelenskyy surprised by Trump claim of Russia-Ukraine energy ceasefire'),
    candidate('Zelenskyy welcomes US-announced energy ceasefire'),
  ), true)
})

test('institution acronyms bind differently framed reports to one event thread', () => {
  assert.equal(candidatesDescribeSameThread(
    candidate('US unveils sanctions on ICC in move court condemns'),
    candidate('US sanctions on ICC put global justice at risk'),
  ), true)
})

test('same Nepal flood and Ukraine ceasefire developments consolidate despite long headlines', () => {
  assert.equal(candidatesDescribeSameThread(
    candidate('Nepal flash flood washes away houses and bridges'),
    candidate('Nepal orders evacuations after landslide triggers Budhi Gandaki flash flood'),
  ), true)
  assert.equal(candidatesDescribeSameThread(
    candidate('Russia attacks power plants after Trump energy ceasefire claim'),
    candidate('Energy ceasefire confusion in Kyiv after fresh strikes'),
  ), true)
})
