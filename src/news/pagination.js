const words = value => String(value || '').trim().split(/\s+/).filter(Boolean)

function sentenceChunks(text) {
  const clean = String(text || '').trim()
  if (!clean) return []
  return clean.match(/[^.!?]+[.!?][”’"')\]]*|[^.!?]+$/g)?.map(value => value.trim()).filter(Boolean) || [clean]
}

export function displayStoryPages(pages, { targetWords = 80, maximumWords = 92 } = {}) {
  const sourcePages = Array.isArray(pages) ? pages : []
  const result = []
  const sentences = sentenceChunks(sourcePages.map(page => page?.text || '').join(' '))
  let current = []
  let currentWords = 0
  for (const sentence of sentences) {
    const sentenceWords = words(sentence).length
    if (current.length && currentWords + sentenceWords > maximumWords) {
      result.push({ text: current.join(' ') })
      current = []
      currentWords = 0
    }
    current.push(sentence)
    currentWords += sentenceWords
    if (currentWords >= targetWords) {
      result.push({ text: current.join(' ') })
      current = []
      currentWords = 0
    }
  }
  if (current.length) result.push({ text: current.join(' ') })
  while (result.length > 3) {
    let mergeAt = 0
    let smallestPair = Number.POSITIVE_INFINITY
    for (let index = 0; index < result.length - 1; index += 1) {
      const pairWords = words(`${result[index].text} ${result[index + 1].text}`).length
      if (pairWords < smallestPair) { smallestPair = pairWords; mergeAt = index }
    }
    result.splice(mergeAt, 2, { text: `${result[mergeAt].text} ${result[mergeAt + 1].text}` })
  }
  return result.length ? result : [{ text: 'No summary was provided.' }]
}
