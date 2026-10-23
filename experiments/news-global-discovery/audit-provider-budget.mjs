import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FREE_ALLOWANCE_GUARD = Object.freeze({
  exaMonthlyDollars: 9.25,
  tavilyMonthlyCredits: 950,
  longestMonthDays: 31,
  fullRunsPerDay: 1,
})

export function summarizeProviderUsage(reports, guard = FREE_ALLOWANCE_GUARD) {
  const usage = { exaDollars: 0, tavilyCredits: 0 }
  for (const report of reports) {
    if (report?.provider === 'exa') usage.exaDollars += Number(report.costDollars || 0)
    if (report?.provider === 'tavily') usage.tavilyCredits += Number(report.creditsUsed || 0)
  }
  usage.exaDollars = Number(usage.exaDollars.toFixed(6))
  const multiplier = guard.longestMonthDays * guard.fullRunsPerDay
  const projection = {
    exaMonthlyDollars: Number((usage.exaDollars * multiplier).toFixed(3)),
    tavilyMonthlyCredits: usage.tavilyCredits * multiplier,
  }
  const checks = {
    exaWithinGuard: projection.exaMonthlyDollars <= guard.exaMonthlyDollars,
    tavilyWithinGuard: projection.tavilyMonthlyCredits <= guard.tavilyMonthlyCredits,
  }
  return { usage, projection, guard, checks, safeForDailyFullRun: Object.values(checks).every(Boolean) }
}

async function readExisting(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2), reports = [], reportPaths = []
  let output = null
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--report') reportPaths.push(args[++index])
    else if (args[index] === '--output') output = args[++index]
  }
  if (!reportPaths.length || !output) throw new Error('at least one --report and --output are required')
  for (const reportPath of reportPaths) {
    const report = await readExisting(reportPath)
    if (report) reports.push(report)
  }
  const summary = { schemaVersion: 1, createdAt: new Date().toISOString(), reportsFound: reports.length, ...summarizeProviderUsage(reports) }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (!summary.safeForDailyFullRun) throw new Error('Provider use would exceed the guarded recurring-free allowance at one full run per day.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
