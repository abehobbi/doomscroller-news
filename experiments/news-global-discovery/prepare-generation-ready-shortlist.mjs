import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function prepareGenerationShortlist(readiness) {
  const selected = (readiness.generationReady || []).sort((a, b) => a.rank - b.rank).map(item => ({
    ...item,
    image: { ...item.image, url: item.imageProbe?.finalUrl || item.imageProbe?.url || item.image.url },
  }))
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceReadiness: readiness.createdAt, selected }
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output are required')
  const readiness = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const output = prepareGenerationShortlist(readiness)
  const destination = process.argv[outputIndex + 1]
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ selected: output.selected.length, laneCounts: Object.fromEntries([...new Set(output.selected.map(value => value.lane))].map(lane => [lane, output.selected.filter(value => value.lane === lane).length])) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
