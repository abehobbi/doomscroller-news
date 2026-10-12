import fs from 'node:fs/promises'
import path from 'node:path'

const probes = [
  ['los-angeles-mosquitoes', 'Los Angeles unusually severe mosquito season West Nile virus activity decade high'],
  ['lichtenstein-mural', 'Whitney Museum reconstructs Roy Lichtenstein 96-foot Greene Street Mural deliberately destroyed'],
  ['bangladesh-lungi-parade', 'Bangladesh university students faculty lungi parade class prejudice traditional clothing'],
  ['syria-gps-drone', 'Syrian engineer wins aviation AI competition drone navigates without GPS TEKNOFEST Falak'],
  ['syria-tartous-theatre', 'Syria Tartous theatrical production Miniatures memory travel identity'],
  ['education-debt', 'poor countries cutting education spending eight percent since 2019 expensive debt UN warning'],
]

const apiKey = process.env.EXA_API_KEY
if (!apiKey) throw new Error('EXA_API_KEY is not set. No requests were made.')
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null
const end = new Date()
const start = new Date(end.getTime() - 3 * 86_400_000)
const results = []

for (const [id, query] of probes) {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      type: 'auto',
      category: 'news',
      numResults: 5,
      startPublishedDate: start.toISOString(),
      endPublishedDate: end.toISOString(),
      excludeDomains: ['facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'x.com'],
    }),
  })
  const payload = await response.json()
  results.push({
    id,
    query,
    status: response.status,
    requestId: payload.requestId || null,
    costDollars: Number(payload.costDollars?.total || 0),
    results: Array.isArray(payload.results) ? payload.results.map(value => ({
      title: value.title,
      url: value.url,
      publishedAt: value.publishedDate || null,
    })) : [],
    error: response.ok ? null : payload.error || payload,
  })
}

const report = {
  createdAt: new Date().toISOString(),
  requestedWindow: { start: start.toISOString(), end: end.toISOString() },
  totalCostDollars: Number(results.reduce((sum, result) => sum + result.costDollars, 0).toFixed(6)),
  probes: results,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (output) await fs.writeFile(output, json)
else process.stdout.write(json)
