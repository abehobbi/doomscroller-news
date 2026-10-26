import test from 'node:test'
import assert from 'node:assert/strict'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'
import { budgetQueries, isProviderLimitError, selectedQueries } from './exa-five-lane-scout.mjs'
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

test('daily discovery explicitly sweeps four undercovered world regions', () => {
  const themes = new Set(FIVE_LANE_QUERIES.filter(query => query.lane === 'world-interesting').map(query => query.theme))
  assert.deepEqual(
    ['undercovered-africa', 'undercovered-asia-pacific', 'undercovered-europe', 'undercovered-americas'].filter(theme => themes.has(theme)),
    ['undercovered-africa', 'undercovered-asia-pacific', 'undercovered-europe', 'undercovered-americas'],
  )
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
  assert.equal(selectedQueries('depth').length, 26)
  assert.equal(dailySearchBudget().totalQueries, 26)
  assert.equal(NEWS_TIMEZONE, 'America/Toronto')
  assert.deepEqual(DAILY_CARD_GUIDELINE, { expectedMinimum: 30, hardMaximum: 65, paddingAllowed: false })
})

test('a bounded full scan preserves every editorial lane and every priority region', () => {
  const queries = budgetQueries(selectedQueries('full'), 28)
  assert.equal(queries.length, 28)
  assert.deepEqual(new Set(queries.map(query => query.lane)), new Set(['world-major', 'priority-major', 'world-interesting', 'priority-interesting', 'discovery']))
  for (const region of ['Syria', 'Middle East', 'Bangladesh', 'Ghana', 'Canada', 'GTA']) {
    assert.equal(queries.some(query => query.region === region), true)
  }
  assert.equal(queries.filter(query => query.lane === 'discovery').length, 4)
})

test('provider credit exhaustion is recognized as a deferral rather than editorial rejection', () => {
  assert.equal(isProviderLimitError(new Error('gta-major: HTTP 402 You have exceeded your credits limit.')), true)
  assert.equal(isProviderLimitError(new Error('world-major: HTTP 503 temporarily unavailable')), false)
})

test('the free publisher safety net includes arts coverage missed by broad search ranking', () => {
  const guardianArts = SOURCES.find(source => source.id === 'guardian-art-design')
  assert.equal(guardianArts?.feedUrl, 'https://www.theguardian.com/artanddesign/rss')
  assert.match(guardianArts?.limitations || '', /editorial-value/i)
})

test('the free publisher safety net includes place-specific global development reporting', () => {
  const source = SOURCES.find(item => item.id === 'guardian-global-development')
  assert.equal(source?.feedUrl, 'https://www.theguardian.com/global-development/rss')
  assert.match(source?.limitations || '', /place-specific/i)
})

test('the free publisher safety net uses an official current Canada feed without stale ABC feeds', () => {
  const globalNewsCanada = SOURCES.find(source => source.id === 'global-news-canada')
  assert.equal(globalNewsCanada?.feedUrl, 'https://globalnews.ca/canada/feed/')
  assert.equal(globalNewsCanada?.sourceType, 'independent_reporting')
  assert.equal(SOURCES.some(source => /abc\.net\.au/i.test(source.feedUrl)), false)
})

test('the free publisher safety net covers Toronto and specialist discovery gaps', () => {
  const cityNews = SOURCES.find(source => source.id === 'citynews-toronto')
  const physOrg = SOURCES.find(source => source.id === 'phys-org')
  const smithsonian = SOURCES.find(source => source.id === 'smithsonian-smart-news')
  const archaeology = SOURCES.find(source => source.id === 'archaeology-magazine')
  const liveScience = SOURCES.find(source => source.id === 'live-science')
  const conversation = SOURCES.find(source => source.id === 'the-conversation-global')

  assert.equal(cityNews?.feedUrl, 'https://toronto.citynews.ca/feed/')
  assert.deepEqual(cityNews?.coverage, ['GTA'])
  assert.equal(physOrg?.sourceType, 'specialist_reporting')
  assert.match(physOrg?.limitations || '', /underlying research/i)
  assert.equal(smithsonian?.sourceType, 'specialist_reporting')
  assert.match(smithsonian?.limitations || '', /underlying-source attribution/i)
  assert.equal(archaeology?.sourceType, 'specialist_reporting')
  assert.equal(liveScience?.sourceType, 'specialist_reporting')
  assert.equal(conversation?.sourceType, 'expert_analysis')
})
