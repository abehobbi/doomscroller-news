import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function memberView(member) {
  const snapshot = member.snapshot || {}
  return { url: snapshot.finalUrl || snapshot.sourceUrl, publishedAt: snapshot.publishedAt, snapshot }
}

export function prepareRecallShortlist(classification) {
  const candidates = (classification.results || []).filter(item => item.disposition === 'new-event-candidate')
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceClassification: classification.sources,
    selections: candidates.map(item => {
      const event = item.event, representativeMember = event.representative
      const snapshot = representativeMember.snapshot
      const id = `recall-${crypto.createHash('sha256').update(snapshot.finalUrl || snapshot.sourceUrl || item.title).digest('hex').slice(0, 16)}`
      return {
        id, assignedLane: item.lane, adjustedScore: Number(event.selectionScore || 0),
        representative: {
          title: snapshot.title || item.title, url: snapshot.finalUrl || snapshot.sourceUrl,
          publishedAt: snapshot.publishedAt, priorityRegions: representativeMember.selection?.representative?.priorityRegions || [],
        },
        members: (event.members || []).map(memberView),
      }
    }),
  }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const input = value('--input'), output = value('--output')
  if (!input || !output) throw new Error('--input and --output are required')
  const classification = JSON.parse(await fs.readFile(input, 'utf8'))
  const shortlist = prepareRecallShortlist(classification)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(shortlist, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ selections: shortlist.selections.length, lanes: Object.fromEntries([...new Set(shortlist.selections.map(item => item.assignedLane))].map(lane => [lane, shortlist.selections.filter(item => item.assignedLane === lane).length])) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
