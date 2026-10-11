import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const ROUTING = {
  'sudan-drone-strike': { lane: 'world-major', region: null },
  'panama-earthquake': { lane: 'world-major', region: null },
  'canada-jobs': { lane: 'priority-major', region: 'Canada' },
  'navi-pillay-nobel': { lane: 'world-major', region: null },
  'bangladesh-pirojpur-corruption': { lane: 'priority-major', region: 'Bangladesh' },
  'bangladesh-dengue-hospitals': { lane: 'priority-major', region: 'Bangladesh' },
  'ghana-mining-law': { lane: 'priority-major', region: 'Ghana' },
  'ghana-teachers-strike': { lane: 'priority-major', region: 'Ghana' },
}

function domain(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }

export function prepareTargetedGapPool(report, { perTarget = 5 } = {}) {
  const selections = [], usedUrls = new Set()
  for (const search of report.searches || []) {
    const route = ROUTING[search.id]
    if (!route) continue
    let accepted = 0
    for (const [position, result] of (search.results || []).entries()) {
      if (!result.url || usedUrls.has(result.url) || accepted >= perTarget) continue
      usedUrls.add(result.url); accepted += 1
      selections.push({
        id: `gap-${search.id}-${crypto.createHash('sha256').update(result.url).digest('hex').slice(0, 10)}`,
        assignedLane: route.lane,
        poolScore: 100 - position * 4,
        recoveryTarget: search.id,
        representative: {
          ...result,
          domain: domain(result.url),
          lanes: [route.lane],
          priorityRegions: route.region ? [route.region] : [],
          queryIds: [search.id],
          bestPosition: position + 1,
          discoveries: [{ lane: route.lane, region: route.region, queryId: search.id, position: position + 1 }],
        },
      })
    }
  }
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceReport: report.createdAt,
    inputCandidates: (report.searches || []).reduce((sum, search) => sum + (search.results || []).length, 0),
    selectedCount: selections.length, perTarget, selections,
  }
}

async function main() {
  const inputIndex = process.argv.indexOf('--input'), outputIndex = process.argv.indexOf('--output')
  if (inputIndex < 0 || outputIndex < 0) throw new Error('--input and --output are required')
  const report = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'))
  const pool = prepareTargetedGapPool(report)
  await fs.writeFile(process.argv[outputIndex + 1], `${JSON.stringify(pool, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ inputCandidates: pool.inputCandidates, selectedCount: pool.selectedCount, targets: [...new Set(pool.selections.map(item => item.recoveryTarget))].length }, null, 2)}\n`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
