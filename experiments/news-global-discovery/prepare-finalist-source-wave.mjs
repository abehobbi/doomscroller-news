import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output'), limitIndex = process.argv.indexOf('--limit')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output are required')
  const limit = limitIndex < 0 ? 6 : Number(process.argv[limitIndex + 1])
  const report = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const withheld = (report.sourceRepair || []).filter(value => value.lane?.endsWith('major')).sort((a, b) => a.rank - b.rank).slice(0, limit).map(value => ({
    ...value, blindId: value.eventId, destination: value.lane, source: value.primarySource,
    editorialRecommendation: 'baseline-qualified', gapRecoveryRequested: true,
    evaluation: { recommendation: 'baseline-qualified', strongest_fact: value.evidence },
  }))
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), selectionRule: 'highest-ranked unresolved Major finalists', withheld }
  const destination = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ candidates: withheld.length, ranks: withheld.map(value => value.rank), estimatedCostDollars: Number((withheld.length * 0.007).toFixed(3)) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
