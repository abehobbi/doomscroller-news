# Worldwide discovery experiment

This isolated harness tests whether semantic web search can discover local
international reporting that fixed RSS feeds miss. It cannot write to the News
dataset, call Cloudflare, publish, or modify the production pipeline.

The first provider is Tavily's recurring Researcher tier: 1,000 monthly API
credits, no credit card, and requests stop when the free allowance is used.
Eight country-neutral basic searches cost eight credits per run.

```powershell
New-Item -ItemType Directory -Force experiments/news-global-discovery/results
node experiments/news-global-discovery/tavily-discovery.mjs --mode historical --start 2026-09-29 --end 2026-10-04 --output experiments/news-global-discovery/results/historical.json
```

```powershell
node experiments/news-global-discovery/tavily-discovery.mjs --mode fresh --days 3 --output experiments/news-global-discovery/results/fresh.json
```

Set `TAVILY_API_KEY` outside the repository. Reports retain URLs, reported
publication times, query provenance, provider scores, and exact credit usage.
No candidate is treated as publishable without source verification.

## Exa comparison

Exa provides recurring free dollar credits rather than a fixed query count.
The comparison uses eight auto-quality searches with ten results each, the
news category, publication-date bounds, and no paid summaries or page-content
extraction.

```powershell
node experiments/news-global-discovery/exa-discovery.mjs --mode historical --start 2026-09-29 --end 2026-10-04 --output experiments/news-global-discovery/results/exa-historical.json
```

```powershell
node experiments/news-global-discovery/exa-discovery.mjs --mode fresh --days 3 --output experiments/news-global-discovery/results/exa-fresh.json
```

Set `EXA_API_KEY` outside the repository. The report retains Exa's returned
request cost so the free-tier consumption is auditable.

## Five-lane daily-edition scout

The five-lane scout keeps major news, interesting local/world reporting, and
Discovery separate during retrieval. A full daily scan uses 28 searches; the
second same-day update uses only the ten major-news searches.

```powershell
node experiments/news-global-discovery/exa-five-lane-scout.mjs --scan full --days 3 --output experiments/news-global-discovery/results/five-lane-full.json
node experiments/news-global-discovery/exa-five-lane-scout.mjs --scan update --days 2 --output experiments/news-global-discovery/results/five-lane-update.json
```

At the measured Exa auto-search price of $0.007 per search, one full and one
update scan per day project to $7.98 over 30 days. Actual returned costs remain
the source of truth and must be checked before automation.

The offline selector clusters similar titles, applies source and story-quality
signals, and builds a mock edition with a hard ceiling of 65 candidates. Lane
ranges are soft editorial goals: weak stories are not added merely to fill a
quota.

```powershell
node experiments/news-global-discovery/select-five-lane-edition.mjs --input experiments/news-global-discovery/results/five-lane-full.json --output-dir experiments/news-global-discovery/review-output-five-lane --count 65
```

The production-shaped experiment does not select the final 65 before evidence
checks. It first preserves up to five results from each query in a larger pool:

```powershell
node experiments/news-global-discovery/build-five-lane-evidence-pool.mjs --input experiments/news-global-discovery/results/five-lane-full.json --output experiments/news-global-discovery/results/five-lane-pool.json --maximum 160 --per-query 5
```

Before any candidate reaches a writer, the enrichment diagnostic fetches the
public article page, extracts source text and publisher metadata, and records
whether an event-specific image is available. It stores links and text for
testing only; it does not download or republish image bytes.

```powershell
node experiments/news-global-discovery/enrich-five-lane-candidates.mjs --input experiments/news-global-discovery/results/five-lane-pool.json --output experiments/news-global-discovery/results/five-lane-enriched.json
```

The final audit excludes inaccessible/unsupported/image-less candidates and
uses the existing conservative event comparison to collapse duplicates and
material-update chains into one prospective card.

```powershell
node experiments/news-global-discovery/audit-five-lane-edition.mjs --edition experiments/news-global-discovery/results/five-lane-pool.json --enrichment experiments/news-global-discovery/results/five-lane-enriched.json --output-dir experiments/news-global-discovery/review-output-five-lane --count 65
```
