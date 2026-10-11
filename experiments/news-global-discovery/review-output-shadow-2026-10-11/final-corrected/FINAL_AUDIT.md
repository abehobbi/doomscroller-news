# Corrected News shadow edition — final audit

Date: 2026-10-11

Status: review artifact only. Nothing in this milestone was merged into the main checkout or published to Doomscroller Beta.

## Result

- 20 corrected News cards assembled.
- All 20 completed generation and passed the current structural and deterministic audits.
- Lane mix: 4 major-world, 5 major-priority-region, 6 interesting-world, 4 interesting-priority-region, and 1 Discovery card.
- All 20 records contain a publisher-provided image URL.
- Four events that lacked adequate fresh, independent sourcing were replaced instead of being cosmetically rewritten.
- The final test suite passes 80 of 80 tests.

## Reliability work included

- BBC `.com` and `.co.uk` are treated as one publisher family rather than independent corroboration.
- Source verification now enforces freshness.
- Syrian first-order geography cannot be mislabeled as a province.
- Writer-facing output is rejected if it leaks internal pipeline language such as selection gates, source packets, or curator instructions.
- The final edition is assembled deterministically from the accepted base and targeted correction batches.

## Resource use

- Exa discovery and recovery cost for the complete shadow milestone: approximately $0.504, within the configured free allowance.
- Cloudflare generation use through the complete shadow milestone: approximately 1,884.146 neurons, within the free allowance observed during testing.
- No paid service, paid fallback, or automatic paid overage was enabled.

## What this does not prove

- An available publisher image is not automatically a good editorial image. The 20 images still need visual inspection.
- Passing deterministic checks does not replace human judgment about importance, clarity, tone, or whether every fact deserves emphasis.
- This is not yet the production daily pipeline and has not changed the live News feed.

## Recommended next review

Read `CORRECTED_EDITION.md` as one complete edition and judge the selection, ordering, writing, and context. Then visually inspect each linked publisher image before any production-integration decision.
