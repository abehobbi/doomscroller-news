import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function selectGapCandidates(verification, priorRepair, laneGaps) {
  const attempted = new Set((priorRepair.results || []).map(item => item.eventId))
  const repaired = new Set((priorRepair.results || []).filter(item => item.readiness?.ready).map(item => item.eventId))
  const selected = []
  for (const [lane, needed] of Object.entries(laneGaps)) {
    const laneCandidates = verification.repairQueue
      .filter(item => item.lane === lane && !repaired.has(item.eventId))
      .sort((left, right) => Number(attempted.has(left.eventId)) - Number(attempted.has(right.eventId))
        || Number(right.selectionScore || 0) - Number(left.selectionScore || 0))
    selected.push(...laneCandidates.slice(0, needed))
  }
  return selected
}

async function main() {
  const args = process.argv.slice(2)
  const value = flag => args[args.indexOf(flag) + 1]
  const verificationPath = value('--verification'), priorRepairPath = value('--prior-repair'), editionPath = value('--edition'), outputPath = value('--output')
  if (!verificationPath || !priorRepairPath || !editionPath || !outputPath) throw new Error('--verification, --prior-repair, --edition and --output are required')
  const [verification, priorRepair, edition] = await Promise.all([
    fs.readFile(verificationPath, 'utf8').then(JSON.parse), fs.readFile(priorRepairPath, 'utf8').then(JSON.parse), fs.readFile(editionPath, 'utf8').then(JSON.parse),
  ])
  const repairQueue = selectGapCandidates(verification, priorRepair, edition.audit.laneGaps)
  const output = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceVerification: verificationPath, sourceEdition: editionPath,
    requestedLaneGaps: edition.audit.laneGaps, repairQueue,
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ selected: repairQueue.length, lanes: Object.fromEntries(Object.keys(edition.audit.laneGaps).map(lane => [lane, repairQueue.filter(item => item.lane === lane).length])), previouslyAttempted: repairQueue.filter(item => (priorRepair.results || []).some(prior => prior.eventId === item.eventId)).length, headlines: repairQueue.map(item => item.headline) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
