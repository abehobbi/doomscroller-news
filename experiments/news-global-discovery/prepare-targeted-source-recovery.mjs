import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const options = { shortlist: null, output: null, eventIds: [] }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--shortlist') options.shortlist = argv[++index]
    else if (argv[index] === '--output') options.output = argv[++index]
    else if (argv[index] === '--event-id') options.eventIds.push(argv[++index])
  }
  if (!options.shortlist || !options.output || !options.eventIds.length) throw new Error('--shortlist, --output and at least one --event-id are required')
  return options
}

export function prepareTargetedRecovery(shortlist, eventIds) {
  const candidates = new Map([...(shortlist.selected || []), ...(shortlist.withheld || [])].map(value => [value.eventId, value]))
  const missing = eventIds.filter(eventId => !candidates.has(eventId))
  if (missing.length) throw new Error(`Missing requested event IDs: ${missing.join(', ')}`)
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceShortlist: shortlist.createdAt || null,
    withheld: eventIds.map(eventId => {
      const value = candidates.get(eventId)
      return {
        ...value,
        gapRecoveryRequested: true,
        sourceAssessment: { ...(value.sourceAssessment || {}), decision: 'replace-source' },
      }
    }),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const shortlist = JSON.parse(await fs.readFile(options.shortlist, 'utf8'))
  const output = prepareTargetedRecovery(shortlist, options.eventIds)
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ candidates: output.withheld.length, eventIds: output.withheld.map(value => value.eventId) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
