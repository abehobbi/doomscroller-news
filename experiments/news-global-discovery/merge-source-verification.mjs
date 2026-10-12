import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeVerificationResult } from './verify-shortlist-sources.mjs'

export function mergeVerificationReports(reports) {
  const byId = new Map()
  for (const report of reports) for (const result of report.results || []) {
    const prior = byId.get(result.blindId)
    if (!prior) byId.set(result.blindId, result)
    else byId.set(result.blindId, normalizeVerificationResult({
      ...prior,
      accepted: [...(prior.accepted || []), ...(result.accepted || [])],
      rejected: [...(prior.rejected || []), ...(result.rejected || [])],
      verificationPasses: Number(prior.verificationPasses || 1) + 1,
    }))
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceReports: reports.length, results: [...byId.values()] }
}

async function main() {
  const outputIndex = process.argv.indexOf('--output')
  const inputs = process.argv.filter((value, index, argv) => argv[index - 1] === '--input')
  if (outputIndex < 0 || !inputs.length) throw new Error('Provide one or more --input files and --output')
  const reports = await Promise.all(inputs.map(input => fs.readFile(input, 'utf8').then(JSON.parse)))
  const merged = mergeVerificationReports(reports)
  const output = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ sourceReports: merged.sourceReports, results: merged.results.length, withSupport: merged.results.filter(value => value.accepted?.length).length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
