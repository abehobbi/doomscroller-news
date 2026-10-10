import assert from 'node:assert/strict'
import test from 'node:test'
import { assessExtractedEvidence } from './evidence-quality.mjs'

test('rejects article extraction contaminated by repeated reader comments', () => {
  const block = 'Please read our Commenting Policy first. Everybody sing along. They set fire to the brush even during a fire ban. Find out how you can still connect with us.'
  const result = assessExtractedEvidence(`${block} ${block} ${block}`)
  assert.equal(result.adequate, false)
  assert.ok(result.contaminationMarkerCount >= 2)
  assert.ok(result.reasons.some(reason => reason.includes('reader comments')))
})

test('accepts varied article prose without page contamination', () => {
  const result = assessExtractedEvidence('Residents asked the council to restore safe drinking water after the pipeline failed. Engineers began repairs on Thursday and opened two temporary distribution sites. The mayor said testing would continue before the network reopens. Local clinics reported no confirmed illnesses linked to the failure.')
  assert.equal(result.adequate, true)
  assert.equal(result.contaminationMarkerCount, 0)
  assert.equal(result.repeatedSentenceFraction, 0)
})

test('rejects a repeated extraction block even without a known site phrase', () => {
  const block = 'Officials opened the bridge after inspectors completed their safety review. Residents had used a temporary crossing during the repairs. The council published the inspection report on Friday.'
  const result = assessExtractedEvidence(`${block} ${block}`)
  assert.equal(result.adequate, false)
  assert.ok(result.reasons.some(reason => reason.includes('repeated page block')))
})
