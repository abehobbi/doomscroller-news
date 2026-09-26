import fs from 'node:fs/promises'
import { validateNewsBetaDataset } from '../../src/news/schema.js'
import { validateCardContent } from './content-validation.mjs'

const file = process.argv[2] || process.env.NEWS_BETA_DATASET_PATH || 'public/news/beta-feed.json'
const raw = JSON.parse(await fs.readFile(file, 'utf8'))
const valid = validateNewsBetaDataset(raw)
if (!valid) throw new Error(`Invalid News beta dataset: ${file}`)
if (valid.cards.length !== raw.cards.length) throw new Error('News beta dataset contains cards rejected by the client schema')
if (new Set(valid.feed.eventIds).size !== valid.feed.eventIds.length) throw new Error('News beta feed contains duplicate event IDs')
for (const card of valid.cards) {
  if (card.pages.length < 1 || card.pages.length > 3) throw new Error(`Invalid page count for ${card.id}`)
  if (!card.sources.some(source => source.role === 'primary')) throw new Error(`Missing primary source for ${card.id}`)
  const content = validateCardContent(card)
  if (!content.valid) throw new Error(`Invalid prose for ${card.id}: ${content.reasons.join('; ')}`)
}
console.log(`Valid News beta dataset: ${valid.cards.length} cards (${valid.generatedAt})`)
