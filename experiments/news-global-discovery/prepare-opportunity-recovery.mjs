import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const stale = item => (item.readiness?.reasons || []).some(reason => /reporting period|predates|stale/i.test(reason))
const highPotential = item => Number(item.selectionScore || 0) >= 110 || (String(item.lane || '').endsWith('major') && Number(item.selectionScore || 0) >= 90)
const blocker = item => {
  const reasons = item.readiness?.reasons || []
  if (reasons.length === 1 && reasons[0] === 'no verified publisher image recovered') return 'image'
  if (reasons.some(reason => /two independent trusted source families/i.test(reason))) return 'corroboration'
  return 'evidence'
}

export function prepareOpportunityRecovery(verification, repairs, maximum = 6) {
  const latest = new Map([...(verification.repairQueue || []), ...(verification.rejected || [])].map(item => [item.eventId, item]))
  for (const repair of repairs) for (const item of repair.results || []) latest.set(item.eventId, item)
  const ranked = [...latest.values()]
    .filter(item => !item.readiness?.ready && !stale(item) && highPotential(item))
    .sort((left, right) => Number(right.selectionScore || 0) - Number(left.selectionScore || 0))
  const repairQueue = []
  for (const item of ranked) {
    if (repairQueue.length >= maximum) break
    if (!repairQueue.some(selected => selected.lane === item.lane)) repairQueue.push(item)
  }
  for (const item of ranked) {
    if (repairQueue.length >= maximum) break
    if (!repairQueue.includes(item)) repairQueue.push(item)
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    counts: { candidates: repairQueue.length },
    repairQueue: repairQueue.map(item => ({ ...item, opportunityRecovery: { attempt: 2, blocker: blocker(item) } })),
    ready: [],
    rejected: [],
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const verificationFile = value('--verification'), outputFile = value('--output'), maximum = Number(value('--maximum') || 6)
  const repairFiles = args.flatMap((arg, index) => arg === '--repair' ? [args[index + 1]] : [])
  if (!verificationFile || !repairFiles.length || !outputFile) throw new Error('--verification, at least one --repair, and --output are required')
  const verification = JSON.parse(await fs.readFile(verificationFile, 'utf8'))
  const repairs = await Promise.all(repairFiles.map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const output = prepareOpportunityRecovery(verification, repairs, maximum)
  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(output.counts, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
