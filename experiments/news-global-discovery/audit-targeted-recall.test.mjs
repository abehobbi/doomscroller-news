import assert from 'node:assert/strict'
import test from 'node:test'
import { auditRecall, titleSimilarity } from './audit-targeted-recall.mjs'

test('recall audit separates exact and likely event overlap from novel candidates', () => {
  const prior = { candidates: [{ title: 'Major flood strikes northern district', url: 'https://example.com/a?utm_source=x' }] }
  const recall = { candidates: [
    { title: 'Major flood strikes northern district', url: 'https://example.com/a', lanes: ['world-major'] },
    { title: 'Northern district struck by major flood', url: 'https://other.example/b', lanes: ['world-major'] },
    { title: 'New fossil reveals ancient mammal', url: 'https://science.example/c', lanes: ['discovery'] },
  ] }
  const audit = auditRecall(recall, prior, { blocked: [] })
  assert.equal(audit.exactUrlOverlap, 1)
  assert.equal(audit.likelyKnownEventCount, 2)
  assert.equal(audit.novelCandidateCount, 1)
})

test('title similarity is conservative about unrelated generic stories', () => {
  assert.ok(titleSimilarity('Major flood strikes northern district', 'Northern district struck by major flood') >= 0.8)
  assert.ok(titleSimilarity('Major flood strikes northern district', 'Court changes national election law') < 0.8)
})
