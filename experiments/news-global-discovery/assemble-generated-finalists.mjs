import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function failureReasons(result) {
  return Object.entries(result.audits || {})
    .filter(([, audit]) => audit?.valid === false)
    .map(([name, audit]) => ({ check: name, details: audit.reasons || audit.unsupportedExpressions || audit.unsupported_exact_dates || audit.unsupportedNumbers || [] }))
}

export function assembleGeneratedFinalists(original, repair) {
  const repaired = new Map((repair.results || []).map(result => [result.eventId, result]))
  const results = (original.results || []).map(result => {
    const replacement = repaired.get(result.eventId)
    return replacement?.status === 'accepted' ? { ...replacement, generationPass: 'repair' } : { ...result, generationPass: 'original' }
  })
  const accepted = results.filter(result => result.status === 'accepted')
  const quarantined = results.filter(result => result.status !== 'accepted').map(result => ({
    eventId: result.eventId,
    lane: result.lane,
    sourceTitle: result.sourceTitle,
    generatedHeadline: result.card?.headline || null,
    reasons: failureReasons(result),
  }))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    expected: original.expected,
    acceptedCount: accepted.length,
    quarantinedCount: quarantined.length,
    originalGeneration: { accepted: original.accepted, rejected: original.rejected, neurons: original.totalNeurons },
    repairGeneration: { accepted: repair.accepted, rejected: repair.rejected, neurons: repair.totalNeurons },
    totalNeurons: Number(original.totalNeurons || 0) + Number(repair.totalNeurons || 0),
    accepted,
    quarantined,
  }
}

function markdown(edition) {
  const lines = [
    '# Generated News finalist review', '',
    `Accepted: ${edition.acceptedCount} of ${edition.expected}. Quarantined: ${edition.quarantinedCount}.`,
    `Cloudflare usage: ${edition.totalNeurons.toFixed(2)} neurons across the original and bounded repair runs.`, '',
  ]
  for (const [index, result] of edition.accepted.entries()) {
    lines.push(`## ${index + 1}. ${result.card.headline}`, '', `Lane: ${result.lane} · Generation pass: ${result.generationPass}`, '')
    for (const page of result.card.pages) lines.push(page.text, '')
    if (result.card.uncertainties?.length) lines.push(`Uncertainties: ${result.card.uncertainties.join(' · ')}`, '')
    lines.push(`Sources: ${result.sources.map(source => `[${source.publisher}](${source.url})`).join(' · ')}`, '')
  }
  lines.push('# Quarantined cards', '')
  for (const result of edition.quarantined) {
    lines.push(`- **${result.sourceTitle}** (${result.eventId}): ${result.reasons.map(reason => `${reason.check} — ${JSON.stringify(reason.details)}`).join('; ')}`)
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const [originalPath, repairPath, outputDir] = process.argv.slice(2)
  if (!originalPath || !repairPath || !outputDir) throw new Error('Usage: node assemble-generated-finalists.mjs ORIGINAL_REPORT REPAIR_REPORT OUTPUT_DIR')
  const [original, repair] = await Promise.all([originalPath, repairPath].map(async file => JSON.parse(await fs.readFile(file, 'utf8'))))
  const edition = assembleGeneratedFinalists(original, repair)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'GENERATED_FINALISTS.json'), `${JSON.stringify(edition, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(outputDir, 'GENERATED_FINALISTS_REVIEW.md'), markdown(edition), 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ accepted: edition.acceptedCount, quarantined: edition.quarantinedCount, totalNeurons: edition.totalNeurons }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
