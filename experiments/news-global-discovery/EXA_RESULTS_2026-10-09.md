# Exa worldwide discovery benchmark — 2026-10-09

This experiment was isolated from the Doomscroller News pipeline. It did not
modify the dataset, application, scheduled workflow, deployment, or Beta.

## Runs

| Run | Window | Queries | Cost | Raw results | Unique results |
| --- | --- | ---: | ---: | ---: | ---: |
| Historical | 2026-09-29 through 2026-10-04 | 8 | $0.056 | 80 | 77 |
| Fresh | Previous three days | 8 | $0.056 | 80 | 76 |

Total test cost: **$0.112** of Exa's free credits.

## Finding

Exa was dramatically more effective than the tested Tavily configurations for
the worldwide-interest lane. It consistently returned concrete, place-specific
reporting rather than generic homepages and documents.

Representative historical discoveries included:

- an Irish lane converted into a community haven;
- India's first digital-nomad village;
- a Danish village's unusual search for a new grocer;
- revivals of pottery in Bhutan and basketry in Vietnam;
- women sustaining traditional beekeeping in Himachal Pradesh;
- Lake Victoria's wooden-boat builders;
- Cambodian crocodile conservation and Philippine mangrove recovery;
- community restoration returning kiwi to Wellington;
- a Syrian glassblower's working life.

Representative fresh discoveries included:

- Japanese rice-drying traditions and Maya harvest hardship;
- Odisha temple artisans and Fukushima textile weavers;
- Warao women building a pepper-based livelihood in Guyana;
- Nigerian women restoring oil-damaged mangroves;
- Indigenous knowledge supporting Canadian kelp restoration;
- Batam residents protesting data-centre water use;
- daily life reporting from Ghana, Gaza, Armenia, Ukraine, and Iran;
- Kenyan soil restoration and Zambian drought adaptation;
- Khayelitsha entrepreneurs turning invasive plants into biochar.

## Remaining limitations

The results are discovery candidates, not publishable cards. The batch still
contains weak or derivative publishers, publicity, tourism-oriented material,
occasional US results, related stories repeated across query families, and
stories whose publication dates or underlying event dates require independent
verification. Source quality varies substantially.

Exa solves much of the **finding** problem. It does not replace:

1. canonical event clustering and duplicate removal;
2. source-lineage and publisher-quality checks;
3. confirmation that a fresh article describes a genuinely fresh development;
4. ranking against major news and priority-region needs;
5. evidence collection from multiple reliable sources;
6. the existing guarded summary-generation and factual-verification pipeline.

## Sustainable free-tier cost

One eight-query auto-quality run cost $0.056. At two runs per day for 30 days,
the expected search cost is approximately **$3.36 per month**, leaving roughly
$6.64 of the recurring $10 free allowance for branching searches or targeted
priority-region discovery. This excludes optional page-content extraction and
AI summaries, neither of which was requested in this benchmark.

## Recommendation

Exa passes the discovery feasibility test and should replace Tavily as the
leading candidate for the worldwide-interest scout. Tavily can remain an
optional secondary source but is not necessary for an initial architecture.

The next experiment should remain offline from production: normalize Exa's raw
results, reject unsuitable publishers and non-events, cluster overlaps, and
blindly review a ranked short list. Only after that selection-quality test
passes should Exa be connected to the automatic News workflow.
