import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function buildBlindComparisonPrompt(discovery) {
  const start = discovery?.requestedWindow?.start
  const end = discovery?.requestedWindow?.end
  if (!start || !end) throw new Error('Discovery report has no complete requestedWindow')
  return `Create an independent proposed daily Doomscroller News edition covering only stories first published, newly occurring, or materially updated between ${start} and ${end}. Treat the end timestamp as the strict information cutoff. Do not use or infer anything from another proposed edition.

Find the strongest worthwhile stories across these five separate categories:
1. Major world news
2. Major priority-region news
3. Interesting world stories
4. Interesting priority-region stories
5. Science, archaeology, nature and discovery

Priority regions are Syria; the wider Middle East; Bangladesh; Ghana; and Canada, with additional attention to Ontario and the Greater Toronto Area.

Search broadly across the world, including regional and local publishers and specialist outlets. Go beyond dominant English-language headlines. Give particular attention to consequential but underreported local developments, exploitation, inequality, labour, public services, environmental costs, livelihoods, culture, unusual solutions, and specific stories that teach the reader something about a place or problem. Small stories may qualify when they are genuinely distinctive and worthwhile. Do not include routine publicity, generic speeches, ceremonial announcements, minor appointments, event listings, tourism promotion, ordinary sports, celebrity material, vague explainers or filler.

One card must represent one underlying event or coherent developing-event thread. Consolidate duplicates and wire copies. Include a follow-up only when the development itself occurred inside the window. Apply careful factual verification, distinguish allegations from confirmed facts, and identify material uncertainty.

The edition should normally contain at least 30 genuinely worthwhile stories and never more than 65. The category guides are 10–15 major world, 8–15 major priority-region, 10–20 interesting world, 6–15 interesting priority-region and 4–8 Discovery, but never pad a weak category merely to reach a number.

For every selected story provide: category, factual headline, a concise two-sentence explanation that adds information beyond the headline, publication/event timing, primary source URL, any supporting source URL needed for corroboration, why it belongs, and material uncertainty. Finish with category totals, priority-region totals, and a short list of the strongest stories considered but excluded with reasons.`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const discoveryPath = value('--discovery'), output = value('--output')
  if (!discoveryPath || !output) throw new Error('--discovery and --output are required')
  const discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8'))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${buildBlindComparisonPrompt(discovery)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
