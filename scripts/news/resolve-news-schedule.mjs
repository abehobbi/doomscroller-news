import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TORONTO_ZONE = 'America/Toronto'
export const MORNING_LOCAL_TIME = '08:30'
export const EVENING_LOCAL_TIME = '20:30'
export const DAILY_UTC_CRONS = Object.freeze([
  '30 0 * * *', '45 0 * * *', '30 1 * * *', '45 1 * * *',
  '30 12 * * *', '45 12 * * *', '30 13 * * *', '45 13 * * *',
])

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

export function cliValue(args, flag) {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) return undefined
  return args[index + 1]
}

function retryCron(cron) {
  return cron.replace(/^30 /, '45 ')
}

function torontoParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}

function alreadyPublished(slot, lastPublishedAt, now) {
  const published = new Date(lastPublishedAt || '')
  if (!Number.isFinite(published.getTime())) return false
  const current = torontoParts(now)
  const previous = torontoParts(published)
  if (`${current.year}-${current.month}-${current.day}` !== `${previous.year}-${previous.month}-${previous.day}`) return false
  const publishedMinutes = Number(previous.hour) * 60 + Number(previous.minute)
  return publishedMinutes >= (slot === 'morning' ? 8 * 60 : 20 * 60)
}

export function resolveNewsRun({ event, cron = '', manualScan = 'full', manualWindow = '24', manualPublish = false, productionEnabled = false, lastPublishedAt = '', now = new Date() }) {
  if (event === 'workflow_dispatch') {
    return { run: true, scan: manualScan, windowHours: String(manualWindow), publish: Boolean(manualPublish), editionMode: manualScan === 'major' ? 'major-update' : 'daily', reason: 'manual dispatch' }
  }
  const idle = reason => ({ run: false, scan: 'full', windowHours: '24', publish: false, editionMode: 'daily', reason })
  if (event !== 'schedule') return idle('unsupported event')
  if (!productionEnabled) return idle('NEWS_PRODUCTION_ENABLED is not true')
  const morningCron = expectedCron(MORNING_LOCAL_TIME, now)
  const eveningCron = expectedCron(EVENING_LOCAL_TIME, now)
  if (cron === morningCron || cron === retryCron(morningCron)) {
    if (alreadyPublished('morning', lastPublishedAt, now)) return idle('today’s morning edition is already published')
    return { run: true, scan: 'full', windowHours: '24', publish: true, editionMode: 'daily', reason: `daily ${MORNING_LOCAL_TIME} Toronto edition${cron === morningCron ? '' : ' retry'}` }
  }
  if (cron === eveningCron || cron === retryCron(eveningCron)) {
    if (alreadyPublished('evening', lastPublishedAt, now)) return idle('today’s evening update is already published')
    return { run: true, scan: 'major', windowHours: '12', publish: true, editionMode: 'major-update', reason: `major-news ${EVENING_LOCAL_TIME} Toronto update${cron === eveningCron ? '' : ' retry'}` }
  }
  return idle(`DST guard skipped ${cron}; expected ${morningCron} or ${eveningCron}`)
}

async function main() {
  const args = process.argv.slice(2)
  const value = flag => cliValue(args, flag)
  const result = resolveNewsRun({
    event: value('--event'),
    cron: value('--cron') || '',
    manualScan: value('--manual-scan') || 'full',
    manualWindow: value('--manual-window') || '24',
    manualPublish: value('--manual-publish') === 'true',
    productionEnabled: value('--production-enabled') === 'true',
    lastPublishedAt: value('--last-published-at') || '',
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
