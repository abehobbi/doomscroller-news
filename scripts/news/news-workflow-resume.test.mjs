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
  assert.match(workflow, /--production-enabled "\$\{\{ github\.event_name == 'schedule' \|\| github\.event_name == 'push' \|\| vars\.NEWS_PRODUCTION_ENABLED == 'true' \}\}"/)
  assert.match(workflow, /Enforce recurring-free provider budget/)
})

test('validated publication happens before the generation job can become stranded at handoff', async () => {
  const workflow = await readFile('.github/workflows/update-news.yml', 'utf8')
  assert.match(workflow, /group: news-daily-edition-v2/)
  assert.match(workflow, /Read latest committed edition timestamp/)
  assert.match(workflow, /--input \$\{\{ env\.RUN_ROOT \}\}\/final\/UNATTENDED_SHADOW_EDITION\.json/)
  assert.match(workflow, /git push origin "HEAD:\$\{GITHUB_REF_NAME\}"/)
  assert.doesNotMatch(workflow, /^  publish:\s*$/m)
})

test('committed News data deploys through an independent small workflow', async () => {
  const workflow = await readFile('.github/workflows/publish-committed-news.yml', 'utf8')
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/)
  assert.match(workflow, /public\/news\/beta-feed\.json/)
  assert.match(workflow, /public\/news\/beta-control\.json/)
  assert.match(workflow, /Validate the committed daily edition/)
})
