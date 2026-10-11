# Expanded major-news discovery audit

This is an isolated shadow diagnostic. It did not alter the app, main branch, Beta, deployment, or production data.

## Run

- Provider: Exa free allowance
- Window: 2026-10-08 3:58 p.m. through 2026-10-11 3:58 p.m. Toronto time
- Searches: 32
- Returned search cost: $0.224
- Raw results: 320
- Unique candidates: 300
- Public pages requested for evidence validation: 240
- Evidence-ready pages: 211
- Qualified diagnostic edition: 65 events

This window starts and ends later than the earlier ChatGPT comparison window. It is a fresh operational test, not an exact head-to-head recreation.

## What improved

Compared with the earlier 28-query scan, recognizable candidate coverage changed as follows:

| Benchmark subject | Earlier scan | Expanded scan | Survived evidence-qualified selection |
|---|---:|---:|---|
| Ethiopia/Eritrea/Tigray escalation | 1 | 5 | Yes |
| Ukraine | 3 | 7 | Yes |
| Sudan/Blue Nile | 0 | 2 | No reliable version of the reported 41-death event |
| International Criminal Court sanctions | 0 | 10 | Yes |
| Hurricane Isaias | 0 | 4 | Yes |

The new focused major-news searches therefore recovered several important story families that the broad searches missed.

The qualifying pool also retained the Riyadh airport follow-up and Bangladesh flood story. The new front-page ranker is evaluated separately from discovery.

## What remains missing

Simple title matching did not recover convincing candidates for the Panama earthquake, Canadian September job loss, Navi Pillay's Nobel Peace Prize, the Pirojpur public-works investigation, Bangladesh dengue hospital pressure, Ghana mining-law revision, or Ghana teachers' strike resolution.

Absence from this scan does not prove absence from Exa. Query wording, indexing, publication timestamps, language, result depth, and the shifted test window can all affect retrieval.

## Important downstream finding

The Sudan strike appeared only at result position nine. The old evidence-pool rule preserved five results per query, so it discarded the event before verification. The pool now preserves ten candidates for Major searches while keeping five for Interesting and Discovery searches.

The retrieved Sudan page itself contained only generic website text rather than the article evidence. It therefore still cannot be used safely without source recovery. Discovery succeeded; evidence acquisition did not.

## Conclusion

The expanded searches are a material improvement, but they do not yet provide complete major-news recall. The next experiment should focus on targeted recovery for important missing or evidence-deficient candidates before spending Cloudflare neurons generating cards.
