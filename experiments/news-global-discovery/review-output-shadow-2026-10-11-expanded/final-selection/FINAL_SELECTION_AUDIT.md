# Final candidate-selection audit

This remains a shadow experiment. Nothing was written into the app, published to Beta, deployed, or merged into main.

## Input and cost

- Evidence-qualified pool: 65 events
- Blind Interesting/Discovery candidates: 39
- Complete Cloudflare batches: 5 of 5
- Model: Gemma 4 26B with thinking explicitly disabled
- Retries: 0
- Input tokens: 20,004
- Output tokens: 4,321
- Neurons: 299.70
- Provider latency: 72.985 seconds total
- Invalid or truncated responses: 0

## Selection result

- Final candidates: 52
- Major world: 13
- Major priority-region: 12
- Interesting world: 11
- Interesting priority-region: 10
- Discovery: 6
- Interesting/Discovery candidates withheld after blind review: 12
- Duplicate ICC sanctions candidate consolidated: 1

The count is quality-driven rather than a quota. Major stories first had to survive evidence qualification. Interesting and Discovery stories then needed either a `strong` recommendation or a `possible` recommendation scoring at least 75/100. The hard daily ceiling remains 65.

## Useful judgments

The selector rejected the Syrian entertainment item, the promotional farmer red-carpet item, the generic smallest-school item, duplicate/weak local ballot items, and several thin features. It retained strong human-interest reporting, priority-region stories, accessible Discovery candidates, and distinctive worldwide stories.

## Ordering

Urgency and consequence control the top of the feed. The leading events are the Riyadh airport attack, the Aleppo ceasefire, Bangladesh flooding, the reported Sudan drone strike, Ethiopia–Eritrea escalation, the deadly Russian strike in Ukraine, Hurricane Isaias, and the disputed Ukraine ceasefire announcement.

The source titles in this diagnostic are not final Doomscroller headlines. Card writing must replace generic or publisher-oriented labels while remaining strictly grounded in the evidence.

## Next gate

Before any card generation, run source and image readiness across these 52 finalists. Any candidate lacking adequate independent support where required, a relevant usable publisher image, or sufficient writer-safe evidence must be repaired or withheld. Only the survivors should consume card-writing neurons.
