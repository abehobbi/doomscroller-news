import { completeSentences } from '../../artifacts/summary-feasibility/discovery-evidence-milestone/lib.mjs'

const CONTAMINATION_PATTERNS = [
  /please read our commenting policy/i,
  /sign in to comment|leave a comment|view all comments/i,
  /the views expressed (?:in|by) (?:the )?comments/i,
  /if you get .* from (?:instagram|facebook)/i,
  /find out how you can still connect with us/i,
  /subscribe to (?:our )?(?:newsletter|emails?)/i,
  /all rights reserved/i,
]

const normalizedSentence = sentence => sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function assessExtractedEvidence(value) {
  const text = String(value || '')
  const sentences = completeSentences(text, { maxChars: 20_000, maxSentences: 80 })
  const normalized = sentences.map(normalizedSentence).filter(Boolean)
  const uniqueCount = new Set(normalized).size
  const repeatedSentenceFraction = normalized.length ? (normalized.length - uniqueCount) / normalized.length : 0
  const contaminationMarkers = CONTAMINATION_PATTERNS.filter(pattern => pattern.test(text)).map(pattern => pattern.source)
  const reasons = []
  if (contaminationMarkers.length) reasons.push('reader comments or site boilerplate contaminated the extracted evidence')
  if (normalized.length >= 6 && repeatedSentenceFraction >= 0.25) reasons.push('extracted evidence contains a repeated page block')
  return {
    adequate: reasons.length === 0,
    reasons,
    sentenceCount: normalized.length,
    uniqueSentenceCount: uniqueCount,
    repeatedSentenceFraction: Number(repeatedSentenceFraction.toFixed(3)),
    contaminationMarkerCount: contaminationMarkers.length,
  }
}
