import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compactEvidence } from './editorial-selector.mjs'
import { sourceAssessment } from './selection-safeguards.mjs'

export const LANE_POLICY = Object.freeze({
  'world-interesting': { minimum: 10, maximum: 20 },
  'priority-interesting': { minimum: 6, maximum: 15 },
  'world-major': { minimum: 10, maximum: 15 },
  'priority-major': { minimum: 8, maximum: 15 },
  discovery: { minimum: 4, maximum: 8 },
})
export const HARD_CAP = 65

function parseArgs(argv) {
  const options = { majorFixture: null, edition: null, safeguards: null, verification: null, outputDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--major-fixture') options.majorFixture = argv[++index]
    else if (argv[index] === '--edition') options.edition = argv[++index]
    else if (argv[index] === '--safeguards') options.safeguards = argv[++index]
    else if (argv[index] === '--verification') options.verification = argv[++index]
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index]
  }
  if ((!options.majorFixture && !options.edition) || !options.safeguards || !options.verification || !options.outputDir) {
    throw new Error('Provide --major-fixture or --edition, plus --safeguards, --verification, and --output-dir')
  }
  return options
}

const representativeLane = event => event.representative?.selection?.assignedLane

export function prepareMajorFixture(edition) {
  const events = edition.events
    .filter(event => representativeLane(event)?.endsWith('major'))
    .map((event, index) => {
      const snapshot = event.representative.snapshot
      const selection = event.representative.selection
      return {
        eventId: event.id,
        lane: selection.assignedLane,
        baselineRank: index + 1,
        headline: snapshot.title,
        publishedAt: snapshot.publishedAt,
        priorityRegions: selection.representative?.priorityRegions || [],
        evidence: compactEvidence(snapshot.evidenceText || '', { maxChars: 4200 }),
        primarySource: { publisher: snapshot.publisher, url: snapshot.finalUrl || snapshot.sourceUrl },
        sources: event.members.map(member => ({
          publisher: member.snapshot?.publisher,
          url: member.snapshot?.finalUrl || member.snapshot?.sourceUrl,
          sourceFamily: member.sourceFamily || null,
        })).filter(source => source.publisher && source.url),
        sourceFamilies: event.sourceFamilies || [],
        independentSourceCount: Number(event.independentSourceCount || 0),
        corroborationStatus: event.corroborationStatus || null,
        highRisk: Boolean(event.highRisk),
        selectionScore: Number(event.selectionScore || 0),
      }
    })
  return { schemaVersion: 1, createdAt: new Date().toISOString(), sourceEdition: edition.sourceEdition || null, events }
}

export function verificationFamilies(verificationResult) {
  return new Set((verificationResult?.accepted || []).map(value => value.domain).filter(Boolean)).size
}

export function readinessForAssessment(assessment, supportingFamilies = 0, independentSourceCount = 1) {
  const totalFamilies = independentSourceCount + supportingFamilies
  if (assessment.decision === 'provisionally-usable') return { ready: true, reason: 'established low-risk source is provisionally usable', totalFamilies }
  if (assessment.decision === 'needs-independent-corroboration') {
    return totalFamilies >= 2
      ? { ready: true, reason: 'contested claim has at least two independent source families', totalFamilies }
      : { ready: false, reason: 'contested claim still lacks a second independent source family', totalFamilies }
  }
  if (assessment.decision === 'needs-independent-context') {
    return supportingFamilies >= 1
      ? { ready: true, reason: 'specialist source has independent supporting context', totalFamilies }
      : { ready: false, reason: 'specialist source still needs independent context', totalFamilies }
  }
  if (assessment.decision === 'needs-source-review') {
    return totalFamilies >= 2
      ? { ready: true, reason: 'unregistered primary source is supported by another independent source family', totalFamilies }
      : { ready: false, reason: 'publisher remains unverified and unsupported', totalFamilies }
  }
  if (assessment.decision === 'replace-source') {
    return supportingFamilies >= 1
      ? { ready: true, reason: 'weak original source can be replaced by a trusted supporting source', totalFamilies }
      : { ready: false, reason: 'weak original source has no trusted replacement', totalFamilies }
  }
  return { ready: false, reason: 'unknown source-readiness state', totalFamilies }
}

function majorCandidate(event) {
  const assessment = sourceAssessment({ headline: event.headline, source: event.primarySource, evaluation: { strongest_fact: event.evidence } })
  const readiness = readinessForAssessment(assessment, 0, event.independentSourceCount)
  return {
    eventId: event.eventId,
    lane: event.lane,
    origin: 'qualified-major-pool',
    headline: event.headline,
    evidence: event.evidence,
    publishedAt: event.publishedAt,
    priorityRegions: event.priorityRegions,
    editorialRecommendation: 'baseline-qualified',
    editorialScore: null,
    baselineRank: event.baselineRank,
    primarySource: event.primarySource,
    sources: event.sources,
    sourceAssessment: assessment,
    independentSourceCount: event.independentSourceCount,
    readiness,
  }
}

function safeguardCandidate(item, verificationByBlindId) {
  const verification = verificationByBlindId.get(item.blindId) || null
  const supportingFamilies = verificationFamilies(verification)
  const readiness = readinessForAssessment(item.sourceAssessment, supportingFamilies, 1)
  const sources = [item.source, ...(verification?.accepted || []).map(value => ({ publisher: value.domain, url: value.url }))]
  return {
    blindId: item.blindId,
    eventId: item.eventId,
    lane: item.destination,
    origin: item.destination.endsWith('major') ? 'rerouted-to-major' : 'editorial-candidate',
    headline: item.headline,
    evidence: item.evidence,
    publishedAt: item.publishedAt,
    priorityRegions: item.priorityRegions || [],
    editorialRecommendation: item.evaluation.recommendation,
    editorialScore: item.editorialScore,
    baselineRank: item.baselineRank,
    primarySource: item.source,
    sources,
    sourceAssessment: item.sourceAssessment,
    independentSourceCount: readiness.totalFamilies,
    verificationStatus: verification?.status || 'not-requested',
    readiness,
  }
}

const recommendationRank = value => value === 'strong' ? 0 : value === 'possible' ? 1 : value === 'baseline-qualified' ? 2 : 3

export function compareCandidates(left, right) {
  const recommendation = recommendationRank(left.editorialRecommendation) - recommendationRank(right.editorialRecommendation)
  if (recommendation) return recommendation
  const score = Number(right.editorialScore ?? right.selectionScore ?? 0) - Number(left.editorialScore ?? left.selectionScore ?? 0)
  if (score) return score
  return Number(left.baselineRank || 9999) - Number(right.baselineRank || 9999) || left.eventId.localeCompare(right.eventId)
}

export function selectLane(candidates, policy) {
  const strong = candidates.filter(value => value.editorialRecommendation === 'strong').sort(compareCandidates)
  const baseline = candidates.filter(value => value.editorialRecommendation === 'baseline-qualified').sort(compareCandidates)
  const possible = candidates.filter(value => value.editorialRecommendation === 'possible').sort(compareCandidates)
  const preferred = [...strong, ...baseline].slice(0, policy.maximum)
  const remainingSlots = Math.max(0, policy.maximum - preferred.length)
  const neededForMinimum = Math.max(0, policy.minimum - preferred.length)
  const possibleTake = Math.min(possible.length, remainingSlots, neededForMinimum)
  const selected = [...preferred, ...possible.slice(0, possibleTake)]
  const selectedIds = new Set(selected.map(value => value.eventId))
  return {
    selected,
    overflow: candidates.filter(value => !selectedIds.has(value.eventId)).map(value => ({
      ...value,
      readiness: {
        ...value.readiness,
        ready: false,
        reason: value.editorialRecommendation === 'possible' && selected.length >= policy.minimum
          ? 'possible story not needed after the lane minimum was met'
          : `lane maximum of ${policy.maximum} reached`,
      },
    })),
  }
}

export function buildShortlist(majorFixture, safeguards, verification) {
  const verificationByBlindId = new Map(verification.results.map(value => [value.blindId, value]))
  const byEventId = new Map()
  for (const event of majorFixture.events) byEventId.set(event.eventId, majorCandidate(event))
  for (const item of safeguards.results) {
    if (item.destination === 'reject' || item.evaluation.recommendation === 'reject') continue
    const candidate = safeguardCandidate(item, verificationByBlindId)
    const existing = byEventId.get(candidate.eventId)
    if (!existing || candidate.origin === 'rerouted-to-major') byEventId.set(candidate.eventId, candidate)
  }

  const ready = [], withheld = []
  for (const candidate of byEventId.values()) (candidate.readiness.ready ? ready : withheld).push(candidate)
  const selected = [], overflow = []
  for (const lane of Object.keys(LANE_POLICY)) {
    const candidates = ready.filter(value => value.lane === lane).sort(compareCandidates)
    const laneSelection = selectLane(candidates, LANE_POLICY[lane])
    selected.push(...laneSelection.selected)
    overflow.push(...laneSelection.overflow)
  }
  selected.sort((left, right) => Object.keys(LANE_POLICY).indexOf(left.lane) - Object.keys(LANE_POLICY).indexOf(right.lane) || compareCandidates(left, right))
  if (selected.length > HARD_CAP) {
    const removed = selected.splice(HARD_CAP)
    overflow.push(...removed.map(value => ({ ...value, readiness: { ...value.readiness, ready: false, reason: `global hard cap of ${HARD_CAP} reached` } })))
  }
  const laneCounts = Object.fromEntries(Object.keys(LANE_POLICY).map(lane => [lane, selected.filter(value => value.lane === lane).length]))
  const laneStatus = Object.fromEntries(Object.entries(laneCounts).map(([lane, count]) => [lane, {
    count, ...LANE_POLICY[lane], minimumMet: count >= LANE_POLICY[lane].minimum,
  }]))
  return { selected, withheld: [...withheld, ...overflow].sort((a, b) => a.lane.localeCompare(b.lane) || compareCandidates(a, b)), laneCounts, laneStatus }
}

function markdown(report, withheld = false) {
  const title = withheld ? '# Withheld writer candidates' : '# Writer-ready News shortlist'
  const lines = [title, '', `Created: ${report.createdAt}`, '', 'Offline selection artifact only. This does not generate cards or change the app feed.', '']
  const values = withheld ? report.withheld : report.selected
  for (const lane of Object.keys(LANE_POLICY)) {
    const items = values.filter(value => value.lane === lane)
    lines.push(`## ${lane}`, '', withheld ? `${items.length} withheld.` : `${items.length} ready; target ${LANE_POLICY[lane].minimum}–${LANE_POLICY[lane].maximum}.`, '')
    for (const [index, item] of items.entries()) {
      lines.push(`### ${index + 1}. ${item.headline}`, '', `Event: ${item.eventId} · Origin: ${item.origin}`, '', `Source decision: ${item.sourceAssessment.decision}. ${item.readiness.reason}.`, '')
      if (item.primarySource?.url) lines.push(`Primary source: [${item.primarySource.publisher}](${item.primarySource.url})`, '')
      const support = item.sources.slice(1)
      if (support.length) lines.push(`Additional sources: ${support.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
    }
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  let majorFixture
  if (options.edition) majorFixture = prepareMajorFixture(JSON.parse(await fs.readFile(options.edition, 'utf8')))
  else majorFixture = JSON.parse(await fs.readFile(options.majorFixture, 'utf8'))
  const safeguards = JSON.parse(await fs.readFile(options.safeguards, 'utf8'))
  const verification = JSON.parse(await fs.readFile(options.verification, 'utf8'))
  const shortlist = buildShortlist(majorFixture, safeguards, verification)
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), lanePolicy: LANE_POLICY, hardCap: HARD_CAP,
    sourceSafeguards: options.safeguards, sourceVerification: options.verification,
    ...shortlist,
  }
  await fs.mkdir(options.outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, 'MAJOR_SELECTION_FIXTURE.json'), `${JSON.stringify(majorFixture, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'WRITER_READY_SHORTLIST.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'WRITER_READY_SHORTLIST.md'), markdown(report), 'utf8'),
    fs.writeFile(path.join(options.outputDir, 'WITHHELD_CANDIDATES.md'), markdown(report, true), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ selected: report.selected.length, withheld: report.withheld.length, laneCounts: report.laneCounts, laneStatus: report.laneStatus }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
