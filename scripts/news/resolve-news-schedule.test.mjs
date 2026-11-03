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

test('Toronto schedule follows daylight saving', () => {
  assert.equal(expectedDailyCron(new Date('2026-07-01T12:00:00Z')), '30 12 * * *')
  assert.equal(expectedCron(MORNING_LOCAL_TIME, new Date('2026-12-01T12:00:00Z')), '30 13 * * *')
  assert.equal(expectedCron(EVENING_LOCAL_TIME, new Date('2026-12-01T12:00:00Z')), '30 1 * * *')
  const morning = resolveNewsRun({ event: 'schedule', cron: '30 12 * * *', productionEnabled: true, now: new Date('2026-07-01T12:30:00Z') })
  assert.deepEqual({ scan: morning.scan, windowHours: morning.windowHours, publish: morning.publish, editionMode: morning.editionMode }, { scan: 'full', windowHours: '24', publish: true, editionMode: 'daily' })
  const evening = resolveNewsRun({ event: 'schedule', cron: '30 0 * * *', productionEnabled: true, now: new Date('2026-07-02T00:30:00Z') })
  assert.deepEqual({ scan: evening.scan, windowHours: evening.windowHours, publish: evening.publish, editionMode: evening.editionMode }, { scan: 'major', windowHours: '12', publish: true, editionMode: 'major-update' })
  const lateMorning = resolveNewsRun({ event: 'schedule', cron: '30 13 * * *', productionEnabled: true, now: new Date('2026-07-01T13:00:00Z') })
  assert.equal(lateMorning.run, true)
  assert.match(lateMorning.reason, /recovery/)
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
  assert.match(result.reason, /recovery/)
})

test('hourly watchdog recovers a delayed morning or evening edition', () => {
  const morning = resolveNewsRun({ event: 'schedule', cron: '17 * * * *', productionEnabled: true, now: new Date('2026-12-01T15:17:00Z') })
  assert.equal(morning.run, true)
  assert.equal(morning.scan, 'full')
  assert.equal(morning.editionMode, 'daily')
  assert.match(morning.reason, /recovery/)

  const evening = resolveNewsRun({ event: 'schedule', cron: '17 * * * *', productionEnabled: true, now: new Date('2026-12-02T03:17:00Z') })
  assert.equal(evening.run, true)
  assert.equal(evening.scan, 'major')
  assert.equal(evening.editionMode, 'major-update')
  assert.match(evening.reason, /recovery/)
})

test('watchdog stays idle before the morning slot instead of publishing overnight', () => {
  const result = resolveNewsRun({ event: 'schedule', cron: '17 * * * *', productionEnabled: true, now: new Date('2026-12-01T05:17:00Z') })
  assert.equal(result.run, false)
  assert.equal(result.publish, false)
  assert.match(result.reason, /not due yet/)
})

test('watchdog cannot duplicate a completed morning or evening edition', () => {
  const morning = resolveNewsRun({ event: 'schedule', cron: '17 * * * *', productionEnabled: true,
    lastPublishedAt: '2026-12-01T14:05:00Z', now: new Date('2026-12-01T15:17:00Z') })
  assert.equal(morning.run, false)
  const evening = resolveNewsRun({ event: 'schedule', cron: '17 * * * *', productionEnabled: true,
    lastPublishedAt: '2026-12-02T02:10:00Z', now: new Date('2026-12-02T03:17:00Z') })
  assert.equal(evening.run, false)
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
