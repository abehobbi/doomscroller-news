import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function canonical(value) {
  try {
    const url = new URL(value); url.hostname = url.hostname.replace(/^www\./, ''); url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid|traffic_source)/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return String(value || '') }
}

function words(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(word => word.length > 3))
}

export function titleSimilarity(left, right) {
  const a = words(left), b = words(right)
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter(word => b.has(word)).length
  return overlap / Math.min(a.size, b.size)
}

export function auditRecall(recall, priorPool, blockedQueue) {
  const knownUrls = new Set((priorPool.candidates || []).map(item => canonical(item.url)))
  for (const item of blockedQueue.blocked || []) for (const source of item.acceptedSources || []) knownUrls.add(canonical(source.url))
  const knownTitles = (priorPool.candidates || []).map(item => item.title)
  const candidates = (recall.candidates || []).map(candidate => {
    const urlKnown = knownUrls.has(canonical(candidate.url))
    const closestTitleSimilarity = knownTitles.reduce((best, title) => Math.max(best, titleSimilarity(candidate.title, title)), 0)
    return { ...candidate, urlKnown, likelyKnownEvent: urlKnown || closestTitleSimilarity >= 0.8, closestTitleSimilarity: Number(closestTitleSimilarity.toFixed(3)) }
  })
  const novel = candidates.filter(candidate => !candidate.likelyKnownEvent)
  const lanes = [...new Set(candidates.flatMap(candidate => candidate.lanes || []))]
  return {
    totalCandidates: candidates.length, exactUrlOverlap: candidates.filter(candidate => candidate.urlKnown).length,
    likelyKnownEventCount: candidates.filter(candidate => candidate.likelyKnownEvent).length, novelCandidateCount: novel.length,
    lanes: Object.fromEntries(lanes.map(lane => [lane, { total: candidates.filter(item => item.lanes?.includes(lane)).length, novel: novel.filter(item => item.lanes?.includes(lane)).length }])),
    candidates, novel,
  }
}

function markdown(output) {
  const lines = ['# Targeted recall audit', '', `Created: ${output.createdAt}`, '', `${output.novelCandidateCount} of ${output.totalCandidates} search results are not obvious URL or headline matches to the prior pool. They are discovery candidates, not yet verified stories.`, '']
  for (const [lane, counts] of Object.entries(output.lanes)) {
    lines.push(`## ${lane}`, '', `${counts.novel} apparently novel candidates from ${counts.total} results.`, '')
    output.novel.filter(item => item.lanes?.includes(lane)).sort((a, b) => a.bestPosition - b.bestPosition).slice(0, 12).forEach(item => lines.push(`- ${item.title}`, `  - ${item.url}`))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const recallPath = value('--recall'), poolPath = value('--prior-pool'), blockedPath = value('--blocked'), outputDir = value('--output-dir')
  if (!recallPath || !poolPath || !blockedPath || !outputDir) throw new Error('--recall, --prior-pool, --blocked and --output-dir are required')
  const [recall, pool, blocked] = await Promise.all([recallPath, poolPath, blockedPath].map(file => fs.readFile(file, 'utf8').then(JSON.parse)))
  const audit = auditRecall(recall, pool, blocked)
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), sources: { recallPath, poolPath, blockedPath }, ...audit }
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'TARGETED_RECALL_AUDIT.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'TARGETED_RECALL_AUDIT.md'), markdown(output)),
    fs.writeFile(path.join(outputDir, 'NOVEL_TARGETED_RECALL.json'), `${JSON.stringify({ ...recall, rawResultCount: audit.novel.length, uniqueCandidateCount: audit.novel.length, candidates: audit.novel }, null, 2)}\n`),
  ])
  process.stdout.write(`${JSON.stringify({ totalCandidates: output.totalCandidates, exactUrlOverlap: output.exactUrlOverlap, likelyKnownEventCount: output.likelyKnownEventCount, novelCandidateCount: output.novelCandidateCount, lanes: output.lanes }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
