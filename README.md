# Doomscroller News data

This data-only repository preserves the Stage 1 RSS feed at `/news/feed.json` and hosts the isolated automatic-summary beta at `/news/beta-feed.json`. `/news/beta-control.json` is the immediate kill switch: set `enabled` to `false` to make beta builds fall back to Stage 1. The daily beta workflow requires repository secrets named `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; it has no paid fallback. No app code, user progress, or credentials are published.
