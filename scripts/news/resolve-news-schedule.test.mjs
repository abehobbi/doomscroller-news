import assert from 'node:assert/strict'
import test from 'node:test'
import { EVENING_LOCAL_TIME, MORNING_LOCAL_TIME, cliValue, expectedCron, expectedDailyCron, resolveNewsRun } from './resolve-news-schedule.mjs'

test('CLI parsing never aliases a missing optional flag to the first argument', () => {
  const args = ['--event', 'schedule', '--cron', '30 13 * * *']
  assert.equal(cliValue(args, '--event'), 'schedule')
  assert.equal(cliValue(args, '--now'), undefined)
  assert.equal(cliValue([...args, '--now'], '--now'), undefined)
  assert.equal(cliValue([...args, '--now', '--output'], '--now'), undefined)
})

test('Toronto schedule follows daylight saving without running both UTC crons', () => {
  assert.equal(expectedDailyCron(new Date('2026-07-01T12:00:00Z')), '30 12 * * *')
  assert.equal(expectedCron(MORNING_LOCAL_TIME, new Date('2026-12-01T12:00:00Z')), '30 13 * * *')
  assert.equal(expectedCron(EVENING_LOCAL_TIME, new Date('2026-12-01T12:00:00Z')), '30 1 * * *')
  const morning = resolveNewsRun({ event: 'schedule', cron: '30 12 * * *', productionEnabled: true, now: new Date('2026-07-01T12:00:00Z') })
  assert.deepEqual({ scan: morning.scan, windowHours: morning.windowHours, publish: morning.publish, editionMode: morning.editionMode }, { scan: 'full', windowHours: '24', publish: true, editionMode: 'daily' })
  const evening = resolveNewsRun({ event: 'schedule', cron: '30 0 * * *', productionEnabled: true, now: new Date('2026-07-01T12:00:00Z') })
  assert.deepEqual({ scan: evening.scan, windowHours: evening.windowHours, publish: evening.publish, editionMode: evening.editionMode }, { scan: 'major', windowHours: '12', publish: true, editionMode: 'major-update' })
  assert.equal(resolveNewsRun({ event: 'schedule', cron: '30 13 * * *', productionEnabled: true, now: new Date('2026-07-01T12:00:00Z') }).run, false)
})

test('scheduled publication is locked until the production variable is enabled', () => {
  const result = resolveNewsRun({ event: 'schedule', cron: '30 0 * * *', productionEnabled: false, now: new Date('2026-07-01T12:00:00Z') })
  assert.equal(result.run, false)
  assert.equal(result.publish, false)
})

test('retry cron runs when the primary trigger was dropped', () => {
  const result = resolveNewsRun({ event: 'schedule', cron: '45 13 * * *', productionEnabled: true, now: new Date('2026-12-01T13:45:00Z') })
  assert.equal(result.run, true)
  assert.equal(result.scan, 'full')
  assert.match(result.reason, /retry/)
})

test('retry cron cannot repeat an edition already published in its Toronto slot', () => {
  const morning = resolveNewsRun({ event: 'schedule', cron: '45 13 * * *', productionEnabled: true,
    lastPublishedAt: '2026-12-01T13:35:00Z', now: new Date('2026-12-01T13:45:00Z') })
  assert.equal(morning.run, false)
  const evening = resolveNewsRun({ event: 'schedule', cron: '45 1 * * *', productionEnabled: true,
    lastPublishedAt: '2026-12-02T01:35:00Z', now: new Date('2026-12-02T01:45:00Z') })
  assert.equal(evening.run, false)
})

test('manual runs remain available and publish only when explicitly requested', () => {
  assert.deepEqual(resolveNewsRun({ event: 'workflow_dispatch', manualScan: 'depth', manualWindow: '72', manualPublish: false }), {
    run: true, scan: 'depth', windowHours: '72', publish: false, editionMode: 'daily', reason: 'manual dispatch',
  })
  assert.equal(resolveNewsRun({ event: 'workflow_dispatch', manualPublish: true }).publish, true)
})
