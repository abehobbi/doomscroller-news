import assert from 'node:assert/strict'
import test from 'node:test'

import { FREE_ALLOWANCE_GUARD, summarizeProviderUsage } from './audit-provider-budget.mjs'

test('one full daily run stays inside guarded Exa and Tavily monthly allowances', () => {
  const report = summarizeProviderUsage([
    { provider: 'exa', costDollars: 0.168 },
    { provider: 'exa', costDollars: 0.056 },
    { provider: 'tavily', creditsUsed: 5 },
    { provider: 'tavily', creditsUsed: 7 },
    { provider: 'tavily', creditsUsed: 3 },
    { provider: 'tavily', creditsUsed: 7 },
    { provider: 'tavily', creditsUsed: 3 },
  ])
  assert.equal(report.safeForDailyFullRun, true)
  assert.deepEqual(report.projection, { exaMonthlyDollars: 6.944, tavilyMonthlyCredits: 775 })
})

test('budget guard fails closed before either recurring allowance is exhausted', () => {
  const exa = summarizeProviderUsage([{ provider: 'exa', costDollars: 0.31 }])
  const tavily = summarizeProviderUsage([{ provider: 'tavily', creditsUsed: 30 }])
  assert.equal(exa.checks.exaWithinGuard, false)
  assert.equal(tavily.checks.tavilyWithinGuard, false)
  assert.equal(FREE_ALLOWANCE_GUARD.exaMonthlyDollars, 9.25)
  assert.equal(FREE_ALLOWANCE_GUARD.tavilyMonthlyCredits, 900)
})
