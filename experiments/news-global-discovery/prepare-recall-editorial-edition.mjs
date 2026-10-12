import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function canonical(value) {
  try { const url = new URL(value); url.hash = ''; return url.toString() } catch { return String(value || '') }
}

export function prepareRecallEditorialEdition(qualified, verification, repair) {
  const ready = [...verification.ready, ...(repair.results || []).filter(item => item.readiness?.ready)]
  const readyUrls = new Set(ready.flatMap(item => item.sources.filter(source => source.accepted).map(source => canonical(source.url))))
  const events = (qualified.events || []).filter(event => (event.members || []).some(member => readyUrls.has(canonical(member.snapshot?.finalUrl || member.snapshot?.sourceUrl))))
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: qualified.sourceEdition, events, qualifiedButNotSelected: [] }
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const qualifiedPath = value('--qualified'), verificationPath = value('--verification'), repairPath = value('--repair'), output = value('--output')
  if (!qualifiedPath || !verificationPath || !repairPath || !output) throw new Error('--qualified, --verification, --repair and --output are required')
  const [qualified, verification, repair] = await Promise.all([qualifiedPath, verificationPath, repairPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const edition = prepareRecallEditorialEdition(qualified, verification, repair)
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, `${JSON.stringify(edition, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ events: edition.events.length }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
