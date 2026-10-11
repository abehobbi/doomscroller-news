import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_BLOCKERS = new Set(['needs-independent-corroboration', 'needs-source-review', 'needs-independent-context', 'replace-source'])
const recommendationRank = value => value === 'strong' ? 0 : value === 'baseline-qualified' ? 1 : 2

function parseArgs(argv) {
  const options = { shortlist: null, verification: [], output: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--shortlist') options.shortlist = argv[++index]
    else if (argv[index] === '--verification') options.verification.push(argv[++index])
    else if (argv[index] === '--output') options.output = argv[++index]
  }
  if (!options.shortlist || !options.output) throw new Error('--shortlist and --output are required')
  return options
}

export function prepareGapRecovery(shortlist, verificationReports = []) {
  const completedIds = new Set(verificationReports.flatMap(report => report.results || []).map(value => value.eventId || value.blindId))
  const gaps = Object.fromEntries(Object.entries(shortlist.laneStatus)
    .map(([lane, status]) => [lane, Math.max(0, Number(status.minimum) - Number(status.count))]))
  const withheld = []
  for (const [lane, gap] of Object.entries(gaps)) {
    if (!gap) continue
    const candidates = shortlist.withheld.filter(value => value.lane === lane
      && !completedIds.has(value.eventId)
      && SOURCE_BLOCKERS.has(value.sourceAssessment?.decision))
      .sort((left, right) => recommendationRank(left.editorialRecommendation) - recommendationRank(right.editorialRecommendation)
        || Number(right.editorialScore || 0) - Number(left.editorialScore || 0)
        || Number(left.baselineRank || 9999) - Number(right.baselineRank || 9999))
    withheld.push(...candidates.slice(0, gap).map(value => ({ ...value, gapRecoveryRequested: true })))
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceShortlist: shortlist.createdAt || null,
    gaps,
    requestedSearches: withheld.length,
    withheld,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const shortlist = JSON.parse(await fs.readFile(options.shortlist, 'utf8'))
  const verification = await Promise.all(options.verification.map(async file => JSON.parse(await fs.readFile(file, 'utf8'))))
  const output = prepareGapRecovery(shortlist, verification)
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ gaps: output.gaps, requestedSearches: output.requestedSearches, headlines: output.withheld.map(value => value.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
