import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readinessForAssessment, verificationFamilies } from './build-writer-ready-shortlist.mjs'

function argumentsFrom(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--audit') values.audit = argv[++index]
    else if (argv[index] === '--verification') values.verification = argv[++index]
    else if (argv[index] === '--output-dir') values.outputDir = argv[++index]
  }
  if (!values.audit || !values.verification || !values.outputDir) throw new Error('--audit, --verification and --output-dir are required')
  return values
}

export function applyVerification(audit, verification) {
  const byId = new Map((verification.results || []).map(value => [value.blindId, value]))
  const candidates = [...audit.ready, ...audit.repair, ...audit.withheld].sort((a, b) => a.rank - b.rank).map(candidate => {
    const result = byId.get(candidate.eventId)
    if (!result) return candidate
    const supportingFamilies = verificationFamilies(result)
    const sourceReadiness = readinessForAssessment(candidate.sourceAssessment, supportingFamilies, candidate.independentSourceCount)
    const sourceBlocker = `sources: ${candidate.sourceReadiness.reason}`
    const blockers = candidate.blockers.filter(value => value !== sourceBlocker)
    if (!sourceReadiness.ready) blockers.push(`sources: ${sourceReadiness.reason}`)
    return {
      ...candidate, sourceReadiness, supportingSources: result.accepted || [],
      verificationStatus: result.status, blockers, readyForWriting: blockers.length === 0,
    }
  })
  const ready = candidates.filter(value => value.readyForWriting)
  const repair = candidates.filter(value => !value.readyForWriting && value.blockers.some(reason => reason.startsWith('sources:')))
  const withheld = candidates.filter(value => !value.readyForWriting && !repair.includes(value))
  return { schemaVersion: 1, createdAt: new Date().toISOString(), candidateCount: candidates.length, readyCount: ready.length, repairCount: repair.length, withheldCount: withheld.length, ready, repair, withheld }
}

function markdown(report) {
  const lines = ['# Source-applied readiness', '', `${report.readyCount} of ${report.candidateCount} finalists are ready for live image probing. ${report.repairCount} still need source repair; ${report.withheldCount} have other blockers.`, '', '## Ready', '']
  report.ready.forEach(item => lines.push(`- ${item.rank}. ${item.headline}`))
  lines.push('', '## Still needs source repair', '')
  report.repair.forEach(item => lines.push(`- ${item.rank}. ${item.headline} — ${item.sourceReadiness.reason}`))
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2))
  const [audit, verification] = await Promise.all([fs.readFile(options.audit, 'utf8').then(JSON.parse), fs.readFile(options.verification, 'utf8').then(JSON.parse)])
  const report = applyVerification(audit, verification)
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'SOURCE_APPLIED_READINESS.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'SOURCE_APPLIED_READINESS.md'), markdown(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ candidateCount: report.candidateCount, readyCount: report.readyCount, repairCount: report.repairCount, withheldCount: report.withheldCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
