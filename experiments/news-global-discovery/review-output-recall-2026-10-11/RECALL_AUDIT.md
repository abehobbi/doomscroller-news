# News depth-discovery recall audit

Date: 2026-10-11 Toronto time

## Result

The combined discovery architecture can retrieve all 12 concrete reference stories supplied during editorial review. It does not depend on a closed publisher list:

- Exa open-web queries are the primary discovery layer.
- Free publisher feeds are a supplementary safety net for useful section reporting that broad search ranking can miss.
- Neither layer decides publication by itself. Freshness, evidence, event deduplication, editorial value, source quality, and daily-cap checks still follow discovery.

## Reference-story coverage

| Reference example | Discovery path |
| --- | --- |
| Uganda chimpanzee civil-war feature | Exa animals/ecology lens |
| Los Angeles mosquito season | Exa urban ecology/public-health lens |
| Roy Lichtenstein mural reconstruction | Guardian Art & Design RSS safety net |
| Australian fox conservation strategy | Exa animals/ecology lens |
| Bechem chicken-capital project | Graphic Online feed; also appeared deeper in Exa Ghana results |
| Bangladesh lungi parade | Exa Bangladesh culture/local-life lens |
| Tagore mural arrests | The Daily Star Bangladesh feed |
| Syrian engineer's GPS-independent drone | Exa Syria science/achievement lens |
| Tartous theatre production | Exa Syria culture/innovation lens |
| UAE tanker crew rescue | Exa rescue/human-stakes lens |
| Debt crowding out education and health spending | Exa debt/essential-services lens |
| Lithium extraction and local water costs | Exa power/exploitation lens |

This is a recall result, not proof that all 12 should become cards. Candidate retrieval is intentionally broader than final selection.

## Cost and schedule

- 8:30 a.m. Toronto: 12 major-news searches.
- 11:00 a.m. Toronto: 22 depth and Discovery searches.
- 8:30 p.m. Toronto: 12 major-news searches.
- Total: 46 Exa searches per day.
- At the observed $0.007 basic-search rate: approximately $0.322 per day or $9.66 over 30 days.
- Publisher-feed collection adds no model or search-API charge.
- The plan uses 10 results per query. A 20-result experiment cost $0.306 for 18 searches and was less efficient than sharper queries, so it was not adopted.

No paid fallback, automatic paid overage, or production integration was added in this milestone.

## Diagnostic evidence

- `DEPTH_SCOUT.json`: original 18-query depth scan; 169 unique candidates for $0.126.
- `SOURCE_SEED_BATCH.json`: 941 publisher-feed articles discovered, 745 fresh and 711 unique; only one feed failed.
- `RECALL_PROBE.json`: six exact diagnostic probes proved the remaining stories were indexed by Exa; total cost $0.042.
- `DEPTH_SCOUT_REFINED_2.json`: temporary 26-query validation scan; 237 unique candidates for $0.182.
- `DEPTH_SCOUT_FINAL.json`: final budget-safe 22-query scan; 207 unique candidates for $0.154 and all nine reference examples assigned to Exa were retrieved.

## Next milestone

Merge Exa and feed candidates into one pre-selection pool, normalize source lineage, then test whether the selector promotes the strongest mix without duplicates or weak filler. Do not generate summaries until that merged shortlist passes editorial review.
