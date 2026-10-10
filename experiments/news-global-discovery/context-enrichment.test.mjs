import assert from 'node:assert/strict'
import test from 'node:test'
import { trustedContextDomain } from './enrich-generation-context.mjs'
import { extractPublicArticle } from './public-article.mjs'

test('context sources require a recognized publisher or institutional domain', () => {
  assert.equal(trustedContextDomain('cbc.ca'), true)
  assert.equal(trustedContextDomain('biologicalsciences.uchicago.edu'), true)
  assert.equal(trustedContextDomain('health.gov.gh'), true)
  assert.equal(trustedContextDomain('random-news-blog.example'), false)
  assert.equal(trustedContextDomain('ghanawebbers.com'), false)
})

test('public article extraction prefers structured article body and publisher image', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="A clear event headline">
      <meta property="og:image" content="/photo.jpg">
      <script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Officials approved the project after a public review. The plan coordinates several permits through one decision. Critics remain concerned about environmental oversight. The committee will hear expert testimony before recommending any final amendments to Parliament."}</script>
    </head><body><p>Please read our Commenting Policy first.</p></body></html>`
  const result = extractPublicArticle(html, 'https://publisher.example/story')
  assert.equal(result.title, 'A clear event headline')
  assert.equal(result.extractionMethod, 'JSON-LD articleBody')
  assert.match(result.evidenceText, /coordinates several permits/)
  assert.equal(result.imageUrl, 'https://publisher.example/photo.jpg')
})
