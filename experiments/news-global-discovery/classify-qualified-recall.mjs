import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidatesDescribeSameThread } from './select-five-lane-edition.mjs'

function headline(value) { return value?.representative?.snapshot?.title || value?.headline || '' }

export function classifyQualifiedRecall(qualified, edition, blockedQueue) {
  const existing = edition.cards || [], blocked = blockedQueue.blocked || []
  const results = (qualified.events || []).map(event => {
    const title = headline(event)
    const existingMatch = existing.find(card => candidatesDescribeSameThread({ title }, { title: card.headline }))
    const blockedMatch = blocked.find(card => candidatesDescribeSameThread({ title }, { title: card.headline }))
    const disposition = existingMatch ? 'existing-event-update' : blockedMatch ? 'blocked-story-recovery' : 'new-event-candidate'
    return { title, lane: event.representative.selection.assignedLane, disposition, matchedEventId: existingMatch?.eventId || blockedMatch?.eventId || null, event }
  })
  return {
    results,
    counts: Object.fromEntries(['new-event-candidate', 'existing-event-update', 'blocked-story-recovery'].map(status => [status, results.filter(item => item.disposition === status).length])),
    laneCounts: Object.fromEntries([...new Set(results.map(item => item.lane))].map(lane => [lane, { total: results.filter(item => item.lane === lane).length, new: results.filter(item => item.lane === lane && item.disposition === 'new-event-candidate').length }])),
  }
}

function markdown(output) {
  const lines = ['# Qualified targeted-recall classification', '', `Created: ${output.createdAt}`, '', `${output.counts['new-event-candidate']} new event candidates · ${output.counts['existing-event-update']} updates to ready events · ${output.counts['blocked-story-recovery']} possible recoveries of blocked stories.`, '']
  for (const status of ['new-event-candidate', 'existing-event-update', 'blocked-story-recovery']) {
    lines.push(`## ${status}`, '')
    output.results.filter(item => item.disposition === status).forEach(item => lines.push(`- ${item.title}`, `  - Lane: ${item.lane}${item.matchedEventId ? ` · matches ${item.matchedEventId}` : ''}`))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const qualifiedPath = value('--qualified'), editionPath = value('--edition'), blockedPath = value('--blocked'), outputDir = value('--output-dir')
  if (!qualifiedPath || !editionPath || !blockedPath || !outputDir) throw new Error('--qualified, --edition, --blocked and --output-dir are required')
  const [qualified, edition, blocked] = await Promise.all([qualifiedPath, editionPath, blockedPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const classification = classifyQualifiedRecall(qualified, edition, blocked)
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), sources: { qualifiedPath, editionPath, blockedPath }, ...classification }
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'QUALIFIED_RECALL_CLASSIFICATION.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'QUALIFIED_RECALL_CLASSIFICATION.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ counts: output.counts, laneCounts: output.laneCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
