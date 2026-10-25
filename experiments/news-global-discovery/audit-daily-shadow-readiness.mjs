import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DAILY_LANE_MINIMUMS = Object.freeze({
  'world-major': 10,
  'priority-major': 8,
  'world-interesting': 10,
  'priority-interesting': 6,
  discovery: 4,
})

const INCOMPLETE_HEADLINE = /\b(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|with)$/i

export function auditDailyShadowReadiness(edition, discovery, budget) {
  const start = Date.parse(discovery?.requestedWindow?.start || '')
  const end = Date.parse(discovery?.requestedWindow?.end || '')
  const windowHours = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 3_600_000 : null
  const cards = edition?.cards || []
  const laneCounts = edition?.audit?.laneCounts || {}
  const laneGaps = Object.fromEntries(Object.entries(DAILY_LANE_MINIMUMS)
    .map(([lane, minimum]) => [lane, Math.max(0, minimum - Number(laneCounts[lane] || 0))])
    .filter(([, gap]) => gap > 0))
  const malformedHeadlines = cards.filter(card => !String(card.headline || '').trim() || INCOMPLETE_HEADLINE.test(String(card.headline).trim())).map(card => card.headline)
  const missingSources = cards.filter(card => !card.primaryUrl || !(card.sources || []).length).map(card => card.headline)
  const missingImages = cards.filter(card => !card.image?.url && !card.imageException?.granted).map(card => card.headline)
  const checks = {
    exactDailyWindow: windowHours !== null && Math.abs(windowHours - 24) < 0.05,
    acceptedMinimum: cards.length >= 30,
    categoryMinimums: Object.keys(laneGaps).length === 0,
    hardMaximum: cards.length <= 65,
    completeHeadlines: malformedHeadlines.length === 0,
    sourceComplete: missingSources.length === 0,
    imageComplete: missingImages.length === 0,
    recurringBudgetSafe: budget?.safeForDailyFullRun === true,
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    windowHours,
    totalCards: cards.length,
    laneCounts,
    laneGaps,
    checks,
    viableDailyEdition: checks.exactDailyWindow && checks.acceptedMinimum && checks.hardMaximum && checks.completeHeadlines && checks.sourceComplete && checks.imageComplete && checks.recurringBudgetSafe,
    strongDailySuccess: Object.values(checks).every(Boolean),
    problems: { malformedHeadlines, missingSources, missingImages },
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const editionPath = value('--edition'), discoveryPath = value('--discovery'), budgetPath = value('--budget'), output = value('--output')
  if (!editionPath || !discoveryPath || !budgetPath || !output) throw new Error('--edition, --discovery, --budget and --output are required')
  const [edition, discovery, budget] = await Promise.all([editionPath, discoveryPath, budgetPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const audit = auditDailyShadowReadiness(edition, discovery, budget)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(audit, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
