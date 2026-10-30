import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TORONTO_ZONE = 'America/Toronto'
export const MORNING_LOCAL_TIME = '08:30'
export const EVENING_LOCAL_TIME = '20:30'
export const DAILY_UTC_CRONS = Object.freeze(['30 0 * * *', '30 1 * * *', '30 12 * * *', '30 13 * * *'])

function utcOffsetHours(date) {
  const part = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(date).find(value => value.type === 'timeZoneName')?.value || ''
  const match = part.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) throw new Error('Could not resolve Toronto UTC offset')
  const value = Number(match[2]) + Number(match[3]) / 60
  return match[1] === '-' ? -value : value
}

export function expectedCron(localTime, date = new Date()) {
  const [hour, minute] = localTime.split(':').map(Number)
  const utcHour = (hour - utcOffsetHours(date) + 24) % 24
  return `${minute} ${utcHour} * * *`
}

export const expectedDailyCron = (date = new Date()) => expectedCron(MORNING_LOCAL_TIME, date)

export function resolveNewsRun({ event, cron = '', manualScan = 'full', manualWindow = '24', manualPublish = false, productionEnabled = false, now = new Date() }) {
  if (event === 'workflow_dispatch') {
    return { run: true, scan: manualScan, windowHours: String(manualWindow), publish: Boolean(manualPublish), editionMode: manualScan === 'major' ? 'major-update' : 'daily', reason: 'manual dispatch' }
  }
  const idle = reason => ({ run: false, scan: 'full', windowHours: '24', publish: false, editionMode: 'daily', reason })
  if (event !== 'schedule') return idle('unsupported event')
  if (!productionEnabled) return idle('NEWS_PRODUCTION_ENABLED is not true')
  const morningCron = expectedCron(MORNING_LOCAL_TIME, now)
  const eveningCron = expectedCron(EVENING_LOCAL_TIME, now)
  if (cron === morningCron) return { run: true, scan: 'full', windowHours: '24', publish: true, editionMode: 'daily', reason: `daily ${MORNING_LOCAL_TIME} Toronto edition` }
  if (cron === eveningCron) return { run: true, scan: 'major', windowHours: '12', publish: false, editionMode: 'major-update', reason: `major-news ${EVENING_LOCAL_TIME} Toronto update; publication remains locked pending update-aware promotion` }
  return idle(`DST guard skipped ${cron}; expected ${morningCron} or ${eveningCron}`)
}

async function main() {
  const args = process.argv.slice(2)
  const value = flag => args[args.indexOf(flag) + 1]
  const result = resolveNewsRun({
    event: value('--event'),
    cron: value('--cron') || '',
    manualScan: value('--manual-scan') || 'full',
    manualWindow: value('--manual-window') || '24',
    manualPublish: value('--manual-publish') === 'true',
    productionEnabled: value('--production-enabled') === 'true',
    now: value('--now') ? new Date(value('--now')) : new Date(),
  })
  const output = value('--output')
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true })
    await fs.appendFile(output, Object.entries(result).map(([key, item]) => `${key}=${item}`).join('\n') + '\n')
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
