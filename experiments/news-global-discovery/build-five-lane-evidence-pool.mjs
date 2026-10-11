import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIVE_LANE_QUERIES } from './five-lane-queries.mjs'

const QUERY = new Map(FIVE_LANE_QUERIES.map(value => [value.id, value]))
const REJECT = /\b(?:tourism|travel guide|things to do|event calendar|press release|sponsored|opinion|podcast|newsletter|celebrity|football|soccer|basketball|tickets?|horoscope|coupon)\b/i

function args(argv) {
  const output = { input: null, destination: null, maximum: 240, perQuery: 5, perMajorQuery: 10 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') output.input = argv[++i]
    else if (argv[i] === '--output') output.destination = argv[++i]
    else if (argv[i] === '--maximum') output.maximum = Number(argv[++i])
    else if (argv[i] === '--per-query') output.perQuery = Number(argv[++i])
    else if (argv[i] === '--per-major-query') output.perMajorQuery = Number(argv[++i])
  }
  if (!output.input || !output.destination) throw new Error('--input and --output are required')
  return output
}

function domain(url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

function prepare(candidate) {
  const discoveries = candidate.discoveries.map(item => ({ ...item, region: item.region || QUERY.get(item.queryId)?.region || null }))
  const best = [...discoveries].sort((a, b) => a.position - b.position)[0]
  const score = 100 - candidate.bestPosition * 4 + Math.min(18, (candidate.queryIds.length - 1) * 6)
  return {
    id: `pool-${crypto.createHash('sha256').update(candidate.url).digest('hex').slice(0, 16)}`,
    assignedLane: best.lane,
    poolScore: score,
    representative: {
      ...candidate, discoveries,
      priorityRegions: [...new Set(discoveries.map(item => item.region).filter(Boolean))],
      domain: domain(candidate.url),
    },
  }
}

export function perQueryTargetForLane(lane, options = { perQuery: 5, perMajorQuery: 10 }) {
  return String(lane).includes('major') ? options.perMajorQuery : options.perQuery
}

async function main() {
  const options = args(process.argv.slice(2))
  const report = JSON.parse(await fs.readFile(options.input, 'utf8'))
  const candidates = report.candidates.filter(item => !REJECT.test(`${item.title} ${item.url}`)).map(prepare)
  const selected = [], used = new Set(), domains = new Map()
  const add = item => {
    if (!item || used.has(item.id) || selected.length >= options.maximum) return false
    if ((domains.get(item.representative.domain) || 0) >= 8) return false
    selected.push(item); used.add(item.id)
    domains.set(item.representative.domain, (domains.get(item.representative.domain) || 0) + 1)
    return true
  }
  for (const query of FIVE_LANE_QUERIES) {
    const matches = candidates.filter(item => item.representative.queryIds.includes(query.id)).sort((a, b) => b.poolScore - a.poolScore)
    const target = perQueryTargetForLane(query.lane, options)
    let accepted = 0
    for (const item of matches) if (add(item) && ++accepted >= target) break
  }
  for (const item of [...candidates].sort((a, b) => b.poolScore - a.poolScore)) add(item)
  const output = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceReport: options.input,
    inputCandidates: report.candidates.length, selectedCount: selected.length,
    perQueryTarget: options.perQuery, perMajorQueryTarget: options.perMajorQuery, maximum: options.maximum, selections: selected,
  }
  await fs.writeFile(options.destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ inputCandidates: output.inputCandidates, selectedCount: output.selectedCount, perQueryTarget: output.perQueryTarget, perMajorQueryTarget: output.perMajorQueryTarget }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
