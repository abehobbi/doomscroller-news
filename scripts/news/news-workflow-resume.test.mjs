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
  assert.match(workflow, /inputs\.external_clock == true \|\| github\.event_name == 'schedule'/)
  assert.match(workflow, /Enforce recurring-free provider budget/)
})

test('validated publication is committed and deployed inside the originating workflow', async () => {
  const workflow = await readFile('.github/workflows/update-news.yml', 'utf8')
  assert.match(workflow, /group: news-daily-edition-v2/)
  assert.match(workflow, /Read latest committed edition timestamp/)
  assert.match(workflow, /--input \$\{\{ env\.RUN_ROOT \}\}\/final\/UNATTENDED_SHADOW_EDITION\.json/)
  assert.match(workflow, /git push origin "HEAD:\$\{GITHUB_REF_NAME\}"/)
  assert.match(workflow, /^  publish:\s*$/m)
  assert.match(workflow, /needs: \[plan, shadow\]/)
  assert.match(workflow, /if: needs\.plan\.outputs\.publish == 'true' && needs\.shadow\.result == 'success'/)
  assert.match(workflow, /ref: \$\{\{ github\.ref_name \}\}/)
  assert.match(workflow, /Validate the committed daily edition before deployment/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
})

test('committed News data deploys through an independent small workflow', async () => {
  const workflow = await readFile('.github/workflows/publish-committed-news.yml', 'utf8')
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/)
  assert.match(workflow, /public\/news\/beta-feed\.json/)
  assert.match(workflow, /public\/news\/beta-control\.json/)
  assert.match(workflow, /Validate the committed daily edition/)
})

test('Cloudflare supplies a primary Toronto clock while GitHub remains the watchdog', async () => {
  const [worker, config, deploy] = await Promise.all([
    readFile('cloudflare/news-scheduler/src/index.js', 'utf8'),
    readFile('cloudflare/news-scheduler/wrangler.toml', 'utf8'),
    readFile('.github/workflows/deploy-news-scheduler.yml', 'utf8'),
  ])
  assert.match(worker, /update-news\.yml\/dispatches/)
  assert.match(worker, /publish_dataset: 'true'/)
  assert.match(worker, /external_clock: 'true'/)
  assert.match(worker, /editionAlreadyPublished/)
  assert.match(config, /30,45 0,1,12,13/)
  assert.match(deploy, /NEWS_SCHEDULER_GITHUB_TOKEN/)
})
