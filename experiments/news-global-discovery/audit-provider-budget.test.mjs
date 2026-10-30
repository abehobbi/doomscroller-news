import assert from 'node:assert/strict'
import test from 'node:test'

import { FREE_ALLOWANCE_GUARD, summarizeProviderUsage } from './audit-provider-budget.mjs'

test('one full daily run stays inside guarded Exa and Tavily monthly allowances', () => {
  const report = summarizeProviderUsage([
    { provider: 'exa', costDollars: 0.168 },
    { provider: 'exa', costDollars: 0.056 },
    { provider: 'exa', costDollars: 0.021 },
    { provider: 'exa', costDollars: 0.021 },
    { provider: 'tavily', creditsUsed: 22 },
    { provider: 'tavily', creditsUsed: 4 },
    { provider: 'tavily', creditsUsed: 4 },
  ])
  assert.equal(report.safeForDailyFullRun, true)
  assert.deepEqual(report.projection, { exaMonthlyDollars: 8.246, tavilyMonthlyCredits: 930 })
})

test('eleven advanced recall searches plus bounded repairs stay free in a 31-day month', () => {
  const report = summarizeProviderUsage([
    { provider: 'tavily', creditsUsed: 22 },
    { provider: 'tavily', creditsUsed: 7 },
  ])
  assert.equal(report.safeForDailyFullRun, true)
  assert.deepEqual(report.projection, { exaMonthlyDollars: 0, tavilyMonthlyCredits: 899 })
})

test('expanded 28-query discovery remains below the guarded monthly Exa allowance', () => {
  const report = summarizeProviderUsage([
    { provider: 'exa', costDollars: 0.196 },
    { provider: 'exa', costDollars: 0.056 },
  ])
  assert.equal(report.safeForDailyFullRun, true)
  assert.equal(report.projection.exaMonthlyDollars, 7.812)
})

test('expanded discovery plus six Exa second chances remains below the monthly guard', () => {
  const report = summarizeProviderUsage([
    { provider: 'exa', costDollars: 0.196 },
    { provider: 'exa', costDollars: 0.056 },
    { provider: 'exa', costDollars: 0.021 },
    { provider: 'exa', costDollars: 0.021 },
    { provider: 'tavily', creditsUsed: 22 },
    { provider: 'tavily', creditsUsed: 4 },
    { provider: 'tavily', creditsUsed: 4 },
  ])
  assert.equal(report.safeForDailyFullRun, true)
  assert.deepEqual(report.projection, { exaMonthlyDollars: 9.114, tavilyMonthlyCredits: 930 })
})

test('budget guard fails closed before either recurring allowance is exhausted', () => {
  const exa = summarizeProviderUsage([{ provider: 'exa', costDollars: 0.31 }])
  const tavily = summarizeProviderUsage([{ provider: 'tavily', creditsUsed: 31 }])
  assert.equal(exa.checks.exaWithinGuard, false)
  assert.equal(tavily.checks.tavilyWithinGuard, false)
  assert.equal(FREE_ALLOWANCE_GUARD.exaMonthlyDollars, 9.25)
  assert.equal(FREE_ALLOWANCE_GUARD.tavilyMonthlyCredits, 950)
})
