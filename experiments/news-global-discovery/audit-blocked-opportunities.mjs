import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const IMAGE_REASON = 'no verified publisher image recovered'

function parseArgs(argv) {
  const options = { verification: null, repair: null, outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--verification') options.verification = argv[++index]
    else if (argv[index] === '--repair') options.repair = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if (!options.verification || !options.repair || !options.outputDir) throw new Error('--verification, --repair and --output-dir are required')
  return options
}

export function blockedCategory(item) {
  const reasons = item.readiness?.reasons || []
  if (item.readiness?.ready) return item.repair?.requestId ? 'rescued-by-source-repair' : 'source-ready'
  if (reasons.length === 1 && reasons[0] === IMAGE_REASON) return Number(item.selectionScore || 0) >= 115 ? 'image-exception-candidate' : 'image-blocked'
  if (reasons.some(reason => /reporting period|predates|stale/i.test(reason))) return 'freshness-blocked'
  if (reasons.some(reason => /no accessible|no trusted|insufficient article evidence/i.test(reason))) return 'evidence-unavailable'
  if (reasons.some(reason => /two independent trusted source families/i.test(reason))) return 'corroboration-blocked'
  return 'mixed-unresolved'
}

export function auditBlockedOpportunities(verification, repair) {
  const repaired = new Map((repair.results || []).map(item => [item.eventId, item]))
  const items = [...(verification.ready || []), ...(verification.repairQueue || []), ...(verification.rejected || [])].map(original => {
    const item = repaired.get(original.eventId) || original
    const category = blockedCategory(item)
    const score = Number(item.selectionScore || 0)
    const highPotential = !item.readiness?.ready && (score >= 110 || (String(item.lane || '').endsWith('major') && score >= 90))
    return {
      eventId: item.eventId, headline: item.headline, lane: item.lane,
      selectionScore: Number(item.selectionScore || 0), category, highPotential,
      reasons: item.readiness?.reasons || [], trustedSourceFamilies: Number(item.readiness?.trustedSourceFamilies || 0),
      acceptedSourceCount: Number(item.readiness?.acceptedSourceCount || 0), repairAttempted: Boolean(item.repair?.requestId),
    }
  })
  const counts = Object.fromEntries([...new Set(items.map(item => item.category))].sort().map(category => [category, items.filter(item => item.category === category).length]))
  const highPotentialBlocked = items.filter(item => item.highPotential).sort((a, b) => b.selectionScore - a.selectionScore)
  return { schemaVersion: 1, createdAt: new Date().toISOString(), counts, highPotentialBlocked, items }
}

function markdown(report) {
  const lines = ['# Blocked News opportunity audit', '', 'This report distinguishes worthwhile-looking candidates that failed the pipeline from ordinary discarded search noise. It does not automatically declare any blocked story publishable.', '', '## Counts', '']
  for (const [category, count] of Object.entries(report.counts)) lines.push(`- ${category}: ${count}`)
  lines.push('', '## High-potential blocked stories', '')
  if (!report.highPotentialBlocked.length) lines.push('- None.')
  for (const item of report.highPotentialBlocked) lines.push(`- **${item.headline}** — ${item.category}; score ${item.selectionScore}; ${item.reasons.join('; ') || 'unspecified blocker'}`)
  lines.push('', '## Every inspected candidate', '')
  for (const item of report.items.sort((a, b) => b.selectionScore - a.selectionScore)) lines.push(`- **${item.headline}** — ${item.category}; ${item.lane}; score ${item.selectionScore}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [verification, repair] = await Promise.all([options.verification, options.repair].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const report = auditBlockedOpportunities(verification, repair)
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'BLOCKED_OPPORTUNITIES.json'), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(options.outputDir, 'BLOCKED_OPPORTUNITIES.md'), markdown(report)),
  ])
  process.stdout.write(`${JSON.stringify({ counts: report.counts, highPotentialBlocked: report.highPotentialBlocked.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
