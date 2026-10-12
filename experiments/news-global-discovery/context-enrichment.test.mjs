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
      <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-10T14:30:00Z","articleBody":"Officials approved the project after a public review. The plan coordinates several permits through one decision. Critics remain concerned about environmental oversight. The committee will hear expert testimony before recommending any final amendments to Parliament."}</script>
    </head><body><p>Please read our Commenting Policy first.</p></body></html>`
  const result = extractPublicArticle(html, 'https://publisher.example/story')
  assert.equal(result.title, 'A clear event headline')
  assert.equal(result.extractionMethod, 'JSON-LD articleBody')
  assert.match(result.evidenceText, /coordinates several permits/)
  assert.equal(result.imageUrl, 'https://publisher.example/photo.jpg')
  assert.equal(result.publishedAt, '2026-10-10T14:30:00Z')
})

test('recognized independent and institutional publishers are accepted without opening the registry to arbitrary sites', () => {
  assert.equal(trustedContextDomain('france24.com'), true)
  assert.equal(trustedContextDomain('toronto.ca'), true)
  assert.equal(trustedContextDomain('malaysiakini.com'), true)
  assert.equal(trustedContextDomain('unknown-content-farm.example'), false)
})

test('public article extraction falls back to JSON-LD publisher images', () => {
  const html = `<script type="application/ld+json">{"@type":"NewsArticle","image":{"contentUrl":"/assets/report-photo.webp"},"articleBody":"This sufficiently long report explains the event and its consequences in complete sentences. Officials supplied supporting details and described what happens next. Independent observers identified the most important unresolved question."}</script>`
  const result = extractPublicArticle(html, 'https://publisher.example/report')
  assert.equal(result.imageUrl, 'https://publisher.example/assets/report-photo.webp')
})
