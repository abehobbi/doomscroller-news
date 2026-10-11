import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { clusterCorroboratedEvents } from './event-corroboration.mjs'
import { selectQualified } from './audit-five-lane-edition.mjs'

function allClusters(report) {
  return [...(report.events || []), ...(report.qualifiedButNotSelected || [])]
}

function memberKey(member) {
  return member?.snapshot?.finalUrl || member?.snapshot?.sourceUrl || member?.selection?.id
}

export function mergeQualifiedReports(reports, maximum = 65) {
  const members = [], used = new Set()
  for (const report of reports) for (const cluster of allClusters(report)) for (const member of cluster.members || []) {
    const key = memberKey(member)
    if (!key || used.has(key) || member.eligible === false) continue
    used.add(key); members.push(member)
  }
  const clusters = clusterCorroboratedEvents(members)
    .filter(cluster => cluster.corroborationStatus !== 'single-source-unattributed')
  const selection = selectQualified(clusters, maximum)
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceReports: reports.map(report => report.sourceEdition || report.createdAt),
    inputMembers: members.length,
    mergedEvents: clusters.length,
    selectedEvents: selection.selected.length,
    laneCounts: selection.laneCounts,
    priorityRegionCounts: selection.regionCounts,
    events: selection.selected,
    qualifiedButNotSelected: selection.remaining,
  }
}

function render(report) {
  const lines = [
    '# Combined evidence-qualified News pool', '',
    `Merged ${report.inputMembers} source pages into ${report.mergedEvents} event clusters; selected ${report.selectedEvents}.`, '',
    '## Lane mix', '',
    ...Object.entries(report.laneCounts).map(([lane, count]) => `- ${lane}: ${count}`), '',
    '## Selected events', '',
  ]
  report.events.forEach((event, index) => {
    const item = event.representative
    lines.push(
      `### ${index + 1}. ${item.snapshot.title || item.selection.representative.title}`, '',
      `- Lane: ${item.selection.assignedLane}`,
      `- Publisher: ${item.snapshot.publisher}`,
      `- Independent source families: ${event.independentSourceCount}`,
      `- Corroboration: ${event.corroborationStatus}`,
      `- Selection score: ${event.selectionScore}`,
      `- Link: ${item.snapshot.finalUrl || item.snapshot.sourceUrl}`, '',
    )
  })
  return `${lines.join('\n')}\n`
}

async function main() {
  const inputs = [], outputIndex = process.argv.indexOf('--output-dir'), maximumIndex = process.argv.indexOf('--maximum')
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === '--input') inputs.push(process.argv[index + 1])
  if (inputs.length < 2 || outputIndex < 0) throw new Error('at least two --input values and --output-dir are required')
  const outputDir = process.argv[outputIndex + 1]
  const maximum = maximumIndex >= 0 ? Number(process.argv[maximumIndex + 1]) : 65
  const reports = await Promise.all(inputs.map(input => fs.readFile(input, 'utf8').then(JSON.parse)))
  const report = mergeQualifiedReports(reports, maximum)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'COMBINED_QUALIFIED_EDITION.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'COMBINED_QUALIFIED_EDITION.md'), render(report), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ inputMembers: report.inputMembers, mergedEvents: report.mergedEvents, selectedEvents: report.selectedEvents, laneCounts: report.laneCounts }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
