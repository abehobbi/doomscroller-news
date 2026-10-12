import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PROMOTIONAL = /\b(?:targets? \d[\d,]* jobs|plans?|proposes?|set to|seeks? investment|deadline for|landmark|launches?|announces?)\b/i
const STATEMENT_OR_EXPLAINER = /\b(?:statement on|joint statement|rules explained|what you need to know|why |how )\b/i
const DERIVATIVE_SCIENCE = /(?:scienmag\.com|sciencetechupdates\.com|nanowerk\.com)$/i

function uniqueByEvent(items) {
  const output = new Map()
  for (const item of items) output.set(item.eventId, item)
  return [...output.values()]
}

export function summarizeRecallGate(verification, repair, edition) {
  const ready = uniqueByEvent([...verification.ready, ...(repair.results || []).filter(item => item.readiness?.ready)])
  const blocked = uniqueByEvent([...(verification.repairQueue || []), ...(repair.results || []).filter(item => !item.readiness?.ready)])
    .filter(item => !ready.some(candidate => candidate.eventId === item.eventId))
  const review = ready.map(item => {
    const domains = item.sources.filter(source => source.accepted).map(source => source.domain)
    const flags = []
    if (PROMOTIONAL.test(item.headline)) flags.push('possible proposal, projection, or promotional framing')
    if (STATEMENT_OR_EXPLAINER.test(item.headline)) flags.push('statement or explainer may not be the underlying event')
    if (domains.some(domain => DERIVATIVE_SCIENCE.test(domain))) flags.push('derivative science publisher requires original research check')
    return { eventId: item.eventId, headline: item.headline, lane: item.lane, flags, acceptedDomains: [...new Set(domains)], readiness: item.readiness }
  })
  const current = edition.audit.laneCounts
  const additions = review.reduce((counts, item) => ({ ...counts, [item.lane]: (counts[item.lane] || 0) + 1 }), {})
  const potentialLaneCounts = Object.fromEntries(Object.keys(current).map(lane => [lane, current[lane] + (additions[lane] || 0)]))
  return { readyForEditorialReview: review, blocked, currentLaneCounts: current, potentialLaneCounts }
}

function markdown(output) {
  const lines = ['# Targeted recall final gate', '', `Created: ${output.createdAt}`, '', `${output.readyForEditorialReview.length} source-ready candidates await editorial comparison. ${output.blocked.length} remain blocked.`, '', `Current lane counts: ${Object.entries(output.currentLaneCounts).map(([lane, count]) => `${lane} ${count}`).join(' · ')}`, '', `Potential counts if every candidate survived: ${Object.entries(output.potentialLaneCounts).map(([lane, count]) => `${lane} ${count}`).join(' · ')}`, '', '## Source-ready, editorial decision pending', '']
  output.readyForEditorialReview.forEach((item, index) => lines.push(`### ${index + 1}. ${item.headline}`, '', `Lane: ${item.lane}`, '', `Sources: ${item.acceptedDomains.join(', ')}`, '', `Review flags: ${item.flags.length ? item.flags.join('; ') : 'none from the deterministic preflight'}`, ''))
  lines.push('## Still blocked', '')
  output.blocked.forEach(item => lines.push(`- ${item.headline}`, `  - ${item.readiness.reasons.join('; ')}`))
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const verificationPath = value('--verification'), repairPath = value('--repair'), editionPath = value('--edition'), outputDir = value('--output-dir')
  if (!verificationPath || !repairPath || !editionPath || !outputDir) throw new Error('--verification, --repair, --edition and --output-dir are required')
  const [verification, repair, edition] = await Promise.all([verificationPath, repairPath, editionPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const summary = summarizeRecallGate(verification, repair, edition)
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), ...summary }
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'RECALL_FINAL_GATE.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'RECALL_FINAL_GATE.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ sourceReady: output.readyForEditorialReview.length, flaggedForCloserReview: output.readyForEditorialReview.filter(item => item.flags.length).length, blocked: output.blocked.length, potentialLaneCounts: output.potentialLaneCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
