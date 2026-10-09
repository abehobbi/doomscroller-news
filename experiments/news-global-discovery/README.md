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
