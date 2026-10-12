import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BLOCKERS = [
  [/reporting period that ended/i, 'stale'],
  [/publication predates the edition window/i, 'stale-supporting-source'],
  [/no accessible, relevant and fresh source evidence|insufficient article evidence|HTTP \d+/i, 'evidence-inaccessible'],
  [/no trusted or registered publisher source/i, 'publisher-unverified'],
  [/lacks two independent source families/i, 'corroboration-missing'],
  [/no verified publisher image recovered/i, 'image-missing'],
  [/does not sufficiently overlap|same-event/i, 'event-match-uncertain'],
]

function unique(values) { return [...new Set(values.filter(Boolean))] }

export function blockerCodes(item) {
  const reasons = [...(item.readiness?.reasons || []), ...(item.sources || []).flatMap(source => source.reasons || [])]
  return unique(reasons.flatMap(reason => BLOCKERS.filter(([pattern]) => pattern.test(reason)).map(([, code]) => code)))
}

export function terminalRejection(item) {
  const terminalStaleness = (item.readiness?.reasons || []).some(reason => /reporting period that ended|publication predates the edition window/i.test(reason))
  return Boolean(terminalStaleness || item.editorialDecision === 'reject' || item.duplicateOf)
}

export function repairAction(codes) {
  if (codes.includes('evidence-inaccessible')) return 'Find an accessible original report, public institutional record, or independent article about this exact event.'
  if (codes.includes('corroboration-missing')) return 'Find a second independent source family confirming the consequential claims.'
  if (codes.includes('publisher-unverified')) return 'Vet the publisher’s ownership and editorial standards, or replace it with an established source.'
  if (codes.includes('event-match-uncertain')) return 'Locate reporting that clearly describes the exact same event rather than related background.'
  if (codes.includes('image-missing')) return 'Recover a legitimate article or institutional image with a traceable source URL.'
  return 'Review the evidence manually and identify a safe, specific repair route.'
}

export function buildBlockedStoryQueue(verification, repairs, edition) {
  const selected = new Set((edition.cards || []).map(card => card.eventId))
  const base = new Map([...(verification.repairQueue || []), ...(verification.rejected || [])].map(item => [item.eventId, item]))
  const attempts = new Map()
  for (const report of repairs) for (const item of report.results || []) {
    base.set(item.eventId, item)
    attempts.set(item.eventId, (attempts.get(item.eventId) || 0) + (item.repair ? 1 : 0))
  }
  const blocked = [], rejected = []
  for (const item of base.values()) {
    if (selected.has(item.eventId) || item.readiness?.ready) continue
    const codes = blockerCodes(item), terminal = terminalRejection(item)
    const record = {
      eventId: item.eventId, headline: item.headline, lane: item.lane, selectionScore: item.selectionScore,
      status: terminal ? 'rejected' : 'promising-blocked', blockerCodes: codes,
      blockerReasons: item.readiness?.reasons || [], repairAction: terminal ? null : repairAction(codes),
      repairAttempts: attempts.get(item.eventId) || 0,
      acceptedSources: (item.sources || []).filter(source => source.accepted).map(source => ({ domain: source.domain, family: source.family, url: source.url })),
      hasImage: Boolean(item.readiness?.image),
    }
    ;(terminal ? rejected : blocked).push(record)
  }
  blocked.sort((left, right) => Number(right.selectionScore || 0) - Number(left.selectionScore || 0))
  rejected.sort((left, right) => Number(right.selectionScore || 0) - Number(left.selectionScore || 0))
  return { blocked, rejected }
}

function markdown(output) {
  const lines = [
    '# News candidate disposition queue', '', `Created: ${output.createdAt}`, '',
    `${output.blocked.length} promising stories are preserved for repair. ${output.rejected.length} stories are rejected for terminal editorial reasons.`, '',
    'A blocked story is not considered false or uninteresting. It is withheld only until the named production requirement is repaired.', '',
    '## Promising but blocked', '',
  ]
  for (const [index, item] of output.blocked.entries()) lines.push(
    `### ${index + 1}. ${item.headline}`, '',
    `Lane: ${item.lane} · score: ${item.selectionScore} · prior repair attempts: ${item.repairAttempts}`, '',
    `Blockers: ${item.blockerCodes.join(', ') || 'manual review required'}`, '', `Next action: ${item.repairAction}`, '',
  )
  lines.push('## Rejected', '')
  for (const item of output.rejected) lines.push(`- ${item.headline}`, `  - ${item.blockerReasons.join('; ') || 'terminal editorial rejection'}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
  const verificationPath = value('--verification'), editionPath = value('--edition'), outputDir = value('--output-dir')
  const repairPaths = args.flatMap((arg, index) => arg === '--repair' ? [args[index + 1]] : [])
  if (!verificationPath || !editionPath || !repairPaths.length || !outputDir) throw new Error('--verification, --edition, at least one --repair, and --output-dir are required')
  const [verification, edition, ...repairs] = await Promise.all([
    fs.readFile(verificationPath, 'utf8').then(JSON.parse), fs.readFile(editionPath, 'utf8').then(JSON.parse),
    ...repairPaths.map(file => fs.readFile(file, 'utf8').then(JSON.parse)),
  ])
  const disposition = buildBlockedStoryQueue(verification, repairs, edition)
  const output = { schemaVersion: 1, createdAt: new Date().toISOString(), sources: { verificationPath, editionPath, repairPaths }, ...disposition }
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'BLOCKED_STORY_QUEUE.json'), `${JSON.stringify(output, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'BLOCKED_STORY_QUEUE.md'), markdown(output)),
  ])
  process.stdout.write(`${JSON.stringify({ blocked: output.blocked.length, rejected: output.rejected.length, byBlocker: Object.fromEntries(unique(output.blocked.flatMap(item => item.blockerCodes)).map(code => [code, output.blocked.filter(item => item.blockerCodes.includes(code)).length])) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
