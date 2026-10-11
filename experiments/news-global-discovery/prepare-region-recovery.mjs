import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REGION_MINIMUMS = Object.freeze({ Syria: 2, 'Middle East': 2, Bangladesh: 2, Ghana: 2, Canada: 2, GTA: 1 })
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

export function prepareRegionRecovery(shortlist, verificationReports = [], minimums = REGION_MINIMUMS) {
  const completedIds = new Set(verificationReports.flatMap(report => report.results || []).map(value => value.eventId || value.blindId))
  const selectedCounts = Object.fromEntries(Object.keys(minimums).map(region => [region,
    (shortlist.selected || []).filter(value => (value.priorityRegions || []).includes(region)).length]))
  const gaps = Object.fromEntries(Object.entries(minimums).map(([region, minimum]) => [region, Math.max(0, minimum - selectedCounts[region])]))
  const requested = [], used = new Set()
  for (const [region, gap] of Object.entries(gaps)) {
    if (!gap) continue
    const candidates = (shortlist.withheld || []).filter(value => (value.priorityRegions || []).includes(region)
      && !completedIds.has(value.eventId) && !used.has(value.eventId)
      && SOURCE_BLOCKERS.has(value.sourceAssessment?.decision)
      && ['strong', 'baseline-qualified', 'possible'].includes(value.editorialRecommendation))
      .sort((left, right) => recommendationRank(left.editorialRecommendation) - recommendationRank(right.editorialRecommendation)
        || Number(right.editorialScore || 0) - Number(left.editorialScore || 0)
        || Number(left.baselineRank || 9999) - Number(right.baselineRank || 9999))
    for (const value of candidates.slice(0, gap)) {
      requested.push({ ...value, gapRecoveryRequested: true, regionRecoveryRequested: region })
      used.add(value.eventId)
    }
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceShortlist: shortlist.createdAt || null, minimums, selectedCounts, gaps, requestedSearches: requested.length, withheld: requested }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const shortlist = JSON.parse(await fs.readFile(options.shortlist, 'utf8'))
  const verification = await Promise.all(options.verification.map(async file => JSON.parse(await fs.readFile(file, 'utf8'))))
  const output = prepareRegionRecovery(shortlist, verification)
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ selectedCounts: output.selectedCounts, gaps: output.gaps, requestedSearches: output.requestedSearches, headlines: output.withheld.map(value => `${value.regionRecoveryRequested}: ${value.headline}`) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
