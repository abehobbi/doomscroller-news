import fs from 'node:fs/promises'
import { validateNewsDataset } from '../../src/news/schema.js'

const file = new URL('../../public/news/feed.json', import.meta.url)
const dataset = validateNewsDataset(JSON.parse(await fs.readFile(file, 'utf8')))
if (!dataset || dataset.feed.articleIds.length === 0) {
  throw new Error('public/news/feed.json is not a valid, non-empty News dataset')
}
const ageHours = (Date.now() - Date.parse(dataset.generatedAt)) / 3_600_000
if (ageHours < -1 || ageHours > 6) throw new Error('News dataset is not a current collection (expected within six hours)')
if (!dataset.sources.some(source => source.status === 'ok')) throw new Error('No successful source collection')
console.log(`News dataset valid: ${dataset.feed.articleIds.length} active articles, ${dataset.articles.length} retained articles.`)

