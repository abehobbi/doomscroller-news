import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('production workflow resumes validated editorial batches without bypassing completion', async () => {
  const workflow = await readFile('.github/workflows/update-news.yml', 'utf8')
  assert.match(workflow, /--resume "\$scores"/)
  assert.match(workflow, /for attempt in 2 3/)
  assert.match(workflow, /exit "\$status"/)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
})

test('scheduled editions cannot be silently disabled by a missing repository variable', async () => {
  const workflow = await readFile('.github/workflows/update-news.yml', 'utf8')
  assert.match(workflow, /--production-enabled "\$\{\{ github\.event_name == 'schedule' \|\| vars\.NEWS_PRODUCTION_ENABLED == 'true' \}\}"/)
  assert.match(workflow, /needs\.plan\.outputs\.publish == 'true' && needs\.shadow\.result == 'success'/)
  assert.match(workflow, /Enforce recurring-free provider budget/)
})
