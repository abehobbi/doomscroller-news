import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function finalizeReadiness(sourceReport, imageReport, imageRepairReport = null) {
  const imageById = new Map((imageReport.results || []).map(value => [value.eventId, value]))
  for (const repaired of imageRepairReport?.repaired || []) imageById.set(repaired.eventId, { ...repaired.image, eventId: repaired.eventId, recoveredFrom: repaired.recoveredFrom })
  const generationReady = [], imageRepair = []
  for (const item of sourceReport.ready || []) {
    const imageProbe = imageById.get(item.eventId)
    const combined = { ...item, imageProbe }
    if (imageProbe?.valid) generationReady.push(combined)
    else imageRepair.push({ ...combined, blockers: [...item.blockers, `image: ${imageProbe?.reason || 'not probed'}`] })
  }
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), candidateCount: sourceReport.candidateCount,
    generationReadyCount: generationReady.length, sourceRepairCount: sourceReport.repair.length,
    imageRepairCount: imageRepair.length, generationReady, sourceRepair: sourceReport.repair, imageRepair,
  }
}

function markdown(report) {
  const lines = ['# Finalist generation-readiness gate', '', `${report.generationReadyCount} of ${report.candidateCount} finalists passed evidence, source and live-image checks. ${report.sourceRepairCount} require source repair and ${report.imageRepairCount} require image repair. No failed candidate is silently admitted.`, '', '## Ready for card generation', '']
  report.generationReady.forEach(item => lines.push(`- ${item.rank}. ${item.headline}`))
  lines.push('', '## Image repair', '')
  report.imageRepair.forEach(item => lines.push(`- ${item.rank}. ${item.headline} — ${item.imageProbe?.reason || 'not probed'}`))
  lines.push('', '## Source repair', '')
  report.sourceRepair.forEach(item => lines.push(`- ${item.rank}. ${item.headline} — ${item.sourceReadiness.reason}`))
  return `${lines.join('\n')}\n`
}

async function main() {
  const sourceIndex = process.argv.indexOf('--source-readiness'), imageIndex = process.argv.indexOf('--image-probe'), repairIndex = process.argv.indexOf('--image-repair'), outputIndex = process.argv.indexOf('--output')
  if (sourceIndex < 0 || imageIndex < 0 || outputIndex < 0) throw new Error('--source-readiness, --image-probe and --output are required')
  const [source, images, repairs] = await Promise.all([
    fs.readFile(process.argv[sourceIndex + 1], 'utf8').then(JSON.parse),
    fs.readFile(process.argv[imageIndex + 1], 'utf8').then(JSON.parse),
    repairIndex < 0 ? null : fs.readFile(process.argv[repairIndex + 1], 'utf8').then(JSON.parse),
  ])
  const report = finalizeReadiness(source, images, repairs)
  const output = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(output), { recursive: true })
  await Promise.all([fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8'), fs.writeFile(output.replace(/\.json$/i, '.md'), markdown(report), 'utf8')])
  process.stdout.write(`${JSON.stringify({ candidateCount: report.candidateCount, generationReadyCount: report.generationReadyCount, sourceRepairCount: report.sourceRepairCount, imageRepairCount: report.imageRepairCount }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
