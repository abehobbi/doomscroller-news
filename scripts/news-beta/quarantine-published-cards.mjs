import fs from 'node:fs'
import path from 'node:path'

function values(flag) {
  return process.argv.flatMap((value, index) => value === flag ? [process.argv[index + 1]] : []).filter(Boolean)
}

const input = path.resolve(process.cwd(), process.argv.includes('--input') ? process.argv[process.argv.indexOf('--input') + 1] : 'public/news/beta-feed.json')
const controlPath = path.resolve(process.cwd(), process.argv.includes('--control') ? process.argv[process.argv.indexOf('--control') + 1] : 'public/news/beta-control.json')
const eventIds = [...new Set(values('--event-id'))]
const reason = process.argv.includes('--reason') ? process.argv[process.argv.indexOf('--reason') + 1] : 'failed post-publication factual audit'

if (!eventIds.length) throw new Error('At least one --event-id is required')

const dataset = JSON.parse(fs.readFileSync(input, 'utf8'))
const control = JSON.parse(fs.readFileSync(controlPath, 'utf8'))
if (!Array.isArray(dataset.cards) || !Array.isArray(dataset.feed?.eventIds)) throw new Error('Invalid News beta dataset')

const existingIds = new Set(dataset.cards.map(card => card.event_id))
const missing = eventIds.filter(eventId => !existingIds.has(eventId))
if (missing.length) throw new Error(`Cannot quarantine missing card(s): ${missing.join(', ')}`)

const quarantineSet = new Set(eventIds)
const remainingCards = dataset.cards.filter(card => !quarantineSet.has(card.event_id))
if (remainingCards.length < 30) throw new Error(`Quarantine would leave ${remainingCards.length} cards, below the accepted minimum of 30`)

const quarantinedAt = new Date().toISOString()
const previousGeneratedAt = dataset.generatedAt
dataset.generatedAt = quarantinedAt
dataset.batchId = `news-quarantine-${quarantinedAt.replaceAll(':', '-').replace('.', '-')}`
dataset.feed.eventIds = dataset.feed.eventIds.filter(eventId => !quarantineSet.has(eventId))
dataset.cards = remainingCards
dataset.policy = {
  ...(dataset.policy || {}),
  previousGeneratedAt,
  quarantined: [
    ...((dataset.policy?.quarantined || []).filter(entry => !quarantineSet.has(entry.eventId))),
    ...eventIds.map(eventId => ({ eventId, reason, quarantinedAt })),
  ],
}
control.updatedAt = quarantinedAt

fs.writeFileSync(input, `${JSON.stringify(dataset, null, 2)}\n`)
fs.writeFileSync(controlPath, `${JSON.stringify(control, null, 2)}\n`)
console.log(JSON.stringify({ quarantined: eventIds, remainingCards: remainingCards.length, generatedAt: quarantinedAt }, null, 2))
