import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TORONTO_ZONE = 'America/Toronto'
export const DAILY_LOCAL_TIME = '20:30'
export const DAILY_UTC_CRONS = Object.freeze(['30 0 * * *', '30 1 * * *'])

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

export function expectedDailyCron(date = new Date()) {
  const [hour, minute] = DAILY_LOCAL_TIME.split(':').map(Number)
  const utcHour = (hour - utcOffsetHours(date) + 24) % 24
  return `${minute} ${utcHour} * * *`
}

export function resolveNewsRun({ event, cron = '', manualScan = 'full', manualWindow = '24', manualPublish = false, productionEnabled = false, now = new Date() }) {
  if (event === 'workflow_dispatch') {
    return { run: true, scan: manualScan, windowHours: String(manualWindow), publish: Boolean(manualPublish), reason: 'manual dispatch' }
  }
  if (event !== 'schedule') return { run: false, scan: 'full', windowHours: '24', publish: false, reason: 'unsupported event' }
  if (!productionEnabled) return { run: false, scan: 'full', windowHours: '24', publish: false, reason: 'NEWS_PRODUCTION_ENABLED is not true' }
  const expected = expectedDailyCron(now)
  if (cron !== expected) return { run: false, scan: 'full', windowHours: '24', publish: false, reason: `DST guard skipped ${cron}; expected ${expected}` }
  return { run: true, scan: 'full', windowHours: '24', publish: true, reason: `daily ${DAILY_LOCAL_TIME} Toronto edition` }
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
