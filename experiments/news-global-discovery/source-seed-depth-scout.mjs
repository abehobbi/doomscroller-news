import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildEvidenceBatch } from '../../scripts/news-beta/pipeline.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultOutput = path.join(here, 'review-output-recall-2026-10-11')
const outputIndex = process.argv.indexOf('--output-dir')
const outputDir = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : defaultOutput

const batch = await buildEvidenceBatch()
await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(path.join(outputDir, 'SOURCE_SEED_BATCH.json'), `${JSON.stringify(batch, null, 2)}\n`)

const lines = [
  '# Source-seed depth scout',
  '',
  `Retrieved: ${batch.retrievedAt}`,
  `Discovered articles: ${batch.counts.discoveredArticles}`,
  `Fresh articles: ${batch.counts.freshArticles}`,
  `Unique articles: ${batch.counts.uniqueArticles}`,
  `Prepared events: ${batch.counts.preparedEvents}`,
  `Source failures: ${batch.counts.sourceFailures}`,
  '',
  ...batch.selected.map((entry, index) => [
    `## ${index + 1}. ${entry.event.primary.title}`,
    '',
    `- Regions: ${entry.event.regions.join(', ') || 'Unclassified'}`,
    `- Score: ${entry.event.score}`,
    `- Publisher: ${entry.event.primary.sourceName}`,
    `- Published: ${entry.event.primary.publishedAt}`,
    `- URL: ${entry.event.primary.url}`,
    '',
  ].join('\n')),
]
await fs.writeFile(path.join(outputDir, 'SOURCE_SEED_REVIEW.md'), `${lines.join('\n')}\n`)

console.log(JSON.stringify({ outputDir, counts: batch.counts }, null, 2))
