import { budgetQueries, selectedQueries } from './exa-five-lane-scout.mjs'

export const NEWS_TIMEZONE = 'America/Toronto'
export const DAILY_CARD_GUIDELINE = Object.freeze({ expectedMinimum: 30, hardMaximum: 65, paddingAllowed: false })
export const DAILY_RUNS = Object.freeze([
  { id: 'morning-major', localTime: '08:30', scan: 'major', maxQueries: 7, purpose: 'New and materially updated major worldwide and priority-region news.' },
  { id: 'daily-depth', localTime: '11:00', scan: 'depth', maxQueries: 12, purpose: 'Worldwide and priority-region interesting reporting plus Discovery.' },
  { id: 'evening-major', localTime: '20:30', scan: 'major', maxQueries: 7, purpose: 'New developments, event-thread updates, replacements, and reranking.' },
])

export function dailySearchBudget() {
  const runs = DAILY_RUNS.map(run => ({ ...run, queryCount: budgetQueries(selectedQueries(run.scan), run.maxQueries).length }))
  return { timezone: NEWS_TIMEZONE, runs, totalQueries: runs.reduce((sum, run) => sum + run.queryCount, 0) }
}
