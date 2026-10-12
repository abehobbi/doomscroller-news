import test from 'node:test'
import assert from 'node:assert/strict'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'
import { selectedQueries } from './exa-five-lane-scout.mjs'
import { dailySearchBudget, DAILY_CARD_GUIDELINE, NEWS_TIMEZONE } from './daily-news-run-plan.mjs'
import { SOURCES } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/sources.mjs'

test('interesting-world discovery explicitly covers the missed editorial dimensions', () => {
  const queries = FIVE_LANE_QUERIES.filter(query => query.lane === 'world-interesting')
  const corpus = queries.map(query => `${query.query} ${query.objective}`).join(' ').toLowerCase()
  for (const signal of ['exploitation', 'animal behaviour', 'cultural identity', 'livelihood', 'rescue', 'education', 'debt', 'resource extraction']) {
    assert.match(corpus, new RegExp(signal))
  }
  assert.equal(new Set(queries.map(query => query.theme)).size, queries.length)
})

test('priority-depth searches cover local life and exploitation without adding forced quotas', () => {
  const regions = new Map(FIVE_LANE_QUERIES.filter(query => query.lane === 'priority-interesting').map(query => [query.region, query]))
  for (const region of ['Syria', 'Middle East', 'Bangladesh', 'Ghana']) {
    assert.match(`${regions.get(region).query} ${regions.get(region).objective}`, /exploitation/i)
  }
  assert.equal(FIVE_LANE_QUERIES.some(query => 'quota' in query), false)
})

test('three daily scans separate major updates from depth discovery within the existing search budget', () => {
  assert.equal(selectedQueries('major').every(query => query.lane.includes('major')), true)
  assert.equal(selectedQueries('depth').every(query => !query.lane.includes('major')), true)
  assert.equal(selectedQueries('major').length, 12)
  assert.equal(selectedQueries('depth').length, 22)
  assert.equal(dailySearchBudget().totalQueries, 46)
  assert.equal(NEWS_TIMEZONE, 'America/Toronto')
  assert.deepEqual(DAILY_CARD_GUIDELINE, { expectedMinimum: 30, hardMaximum: 65, paddingAllowed: false })
})

test('the free publisher safety net includes arts coverage missed by broad search ranking', () => {
  const guardianArts = SOURCES.find(source => source.id === 'guardian-art-design')
  assert.equal(guardianArts?.feedUrl, 'https://www.theguardian.com/artanddesign/rss')
  assert.match(guardianArts?.limitations || '', /editorial-value/i)
})
