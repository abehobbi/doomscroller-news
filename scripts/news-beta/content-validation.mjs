const words = value => String(value || '').trim().split(/\s+/).filter(Boolean)

export function validateCardContent(card) {
  const reasons = []
  const headline = String(card?.headline || '').trim()
  const pages = Array.isArray(card?.pages) ? card.pages : []
  const prose = pages.map(page => String(page?.text || '').trim())
  const wordCount = words(prose.join(' ')).length
  if (!headline) reasons.push('missing headline')
  if (!pages.length || pages.length > 3) reasons.push('page count outside 1-3')
  if (wordCount < 65) reasons.push('summary is too thin for a self-contained beta card')
  if (wordCount > 750) reasons.push('summary exceeds the bounded card length')
  prose.forEach((text, index) => {
    if (words(text).length < 25) reasons.push(`page ${index + 1} is too thin`)
    if (!/[.!?][”’"')\]]?$/.test(text)) reasons.push(`page ${index + 1} ends mid-sentence`)
    if (/(?:^|[.!?]\s+)[1-9]\d?\.(?:\s|$)/.test(text) || /\s+[1-9]\d?\s*$/.test(text)) reasons.push(`page ${index + 1} exposes a citation/list marker`)
  })
  return { valid: reasons.length === 0, reasons, wordCount, pageCount: pages.length }
}
