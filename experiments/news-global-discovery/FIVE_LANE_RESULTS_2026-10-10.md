# Five-lane Exa scout — first full run

Date: 2026-10-10

This experiment remained isolated from the News dataset, Beta deployment, and
the production workflow.

## Retrieval and cost

- Full scan: 28 sequential Exa auto searches
- Raw results: 280
- Unique URLs: 270
- Returned cost: $0.196
- Failed searches: 0
- Projected monthly search cost for one full scan plus one ten-query major-news
  update per day: $7.98 at the measured $0.007 per query

The current $10 recurring free allowance is sufficient for that schedule, but
the margin is small enough that returned costs must be accumulated and checked.
The workflow should stop before the monthly ceiling instead of assuming the
provider price or free allowance will never change.

## Five lanes

The scout retrieved candidates separately for:

1. major world news;
2. major priority-region news;
3. interesting worldwide reporting;
4. interesting priority-region reporting; and
5. Discovery.

The first 65-candidate shortlist used soft lane ranges and a hard total ceiling.
It then fetched public article pages without additional Exa calls. Of those 65
candidates, 58 pages were accessible, 57 supplied enough extractable evidence,
and 57 supplied a publisher image.

After enforcing source-text, image, and priority-region-centrality gates, 53
candidates remained:

- 13 major world;
- 9 major priority-region;
- 18 interesting world;
- 6 interesting priority-region; and
- 7 Discovery.

## Important failure found

A result retrieved by the Syria query had an Exa result title about Syria
considering help in Yemen, but the fetched publisher page's actual central
headline concerned a plane damaged at Riyadh airport. The centrality gate
correctly rejected it. A second Syria candidate did not provide enough usable
source evidence. The final qualified set therefore contained no Syria card.

This demonstrates that query provenance is not geographic proof and that a
quota cannot be declared satisfied until the actual title and lead evidence
establish the region. It also shows that selecting 65 candidates *before*
evidence validation is the wrong order: a failed candidate can leave a regional
gap even when usable backup results existed lower in the retrieval pool.

## Architecture decision

The next iteration must use this order:

1. retrieve all five lanes;
2. build a larger, diverse evidence pool with backup candidates for every
   priority region;
3. fetch article evidence and image metadata;
4. reject inaccessible, unsupported, image-less, mis-centred, stale, and weak
   candidates;
5. cluster duplicate events and update chains;
6. select the final daily edition, up to 65, from the qualified pool; and
7. only then send selected evidence packets to the card writer.

The 65-card number is a ceiling, not a quota. No candidate should be published
merely to reach it.

## Evidence-first rerun

The corrected order was then tested with a 160-candidate evidence pool that
preserved up to five candidates from each query before filling unused space.

- Public pages accessible: 142 of 160
- Evidence-ready: 138
- Publisher images found: 139
- Rejected for evidence, image, or priority-centrality failures: 32
- Qualified event pool after conservative clustering: 125
- Final selected edition: 65

Final lane mix:

- 12 major world
- 13 major priority-region
- 20 interesting world
- 13 interesting priority-region
- 7 Discovery

Priority-query provenance in the selected edition included five Syria, five
wider Middle East, three Bangladesh, two Ghana, eight Canada, and four GTA
candidates. Query provenance is retained only for auditing; the centrality gate
still checks the fetched title and lead before a candidate qualifies.

The evidence-first order recovered five central Syria candidates instead of the
zero produced when the final shortlist was created too early. This validates
the larger backup pool as the correct foundation. It does not yet establish
that all 65 candidates meet final editorial or summary quality: source-family
corroboration, richer event clustering, final ranking, and generated-card review
remain before production integration.

## Corroboration and editorial-ranking pass

The qualified pool was reprocessed with source-family detection and stronger
event comparison. Wire copies count as one family; separate publishers count as
independent only when no wire origin is detected. High-risk single-source
stories must retain explicit attribution, and unattributed high-risk clusters
are excluded before final selection.

The selected 65-card diagnostic edition contains seven multi-source events and
no unattributed high-risk single-source event. Verified examples include the
Toronto bike-lane removal, the EU–China vehicle trade agreement, the Iraq–Syria
oil route, the Bangladesh DP World port concession, and Ghana's BRICS bid.

The pass also found and fixed two clustering failures:

- differently worded reports about the same Jurassic mammal fossil are now one
  event; and
- shared port background no longer merges Bangladesh's DP World concession
  with separate PSA terminal negotiations.

Editorial ranking now rewards concrete major-news actions and understandable
human/local reporting while demoting publicity, vague initiatives, technical
jargon, incomplete headlines, and weaker derivative publishers. This remains
a deterministic pre-writer ranking. Generated headline, summary, image, and
claim-fidelity review is the next milestone.

## Controlled generation trial

Ten saved evidence packets, two from each lane, were sent sequentially to the
established Gemma 4 26B writer with thinking disabled. This was an isolated
feature-branch run: it did not write to the app dataset, Beta, Pages, or main.

- Complete generated cards: 9 of 10
- Cards accepted by every current automated gate: 7 of 10
- Total Cloudflare neuron usage: 387.89
- Input tokens: 31,753
- Output tokens: 3,681
- Total model latency: 63.12 seconds

The three rejected cards exposed three different problems:

1. The kelp-restoration card introduced an unsupported C$250,000 cost. The
   deterministic number check caught it, so this was a useful writer-fidelity
   rejection rather than a validator false positive.
2. The Osoyoos cultural-burn packet contained repeated reader comments and site
   boilerplate instead of the article body. The writer returned only a thin
   33-word card rather than inventing details. A new general evidence-quality
   gate now rejects known comment/navigation markers and repeated page blocks
   before ranking or generation.
3. The two-source Jurassic mammal card reached the 1,024-token completion limit
   and returned malformed, incomplete JSON. Thinking was off, so this is an
   output-shaping/packet-size problem, not hidden reasoning consumption. The
   completion ceiling has not been raised automatically.

An offline rerun of the 160-candidate audit rejected four contaminated pages,
including the cultural-burn candidate, while still filling the 65-card ceiling
from qualified alternatives. The expanded News test suite now has 38 passing
tests. The seven mechanically accepted generations remain review material, not
editorially approved production cards.

## Context-enriched generation comparison

A second isolated ten-card run tested trusted contextual evidence and tighter
writer shaping. Exa searched once per event. The trusted-source gate retained
13 useful additions from primary institutions, established publishers,
universities, and recognized specialist or local outlets. Obscure search-result
sites were excluded. The intended operational cost was $0.07; the development
session spent $0.14 because the search was repeated once after adding the
trusted-source gate.

The writer now prefers one or two compact pages, uses three only for genuinely
complex stories, and has a 1,536-token emergency ceiling. The higher ceiling is
not a length target. It prevents otherwise valid JSON from being cut off after
the prompt has already required concise, non-repetitive prose.

- Complete generated cards: 10 of 10
- Cards accepted by every current automated gate: 9 of 10
- Total Cloudflare neuron usage: 467.57
- Input tokens: 40,839
- Output tokens: 3,574
- Total model latency: 70.45 seconds

Bill C-39 expanded from 239 to 330 words. The additional prose explains the
single-review mechanism, one-year goal, parliamentary committee stage, and the
main labour, environmental, and Indigenous-consultation objections. This is
approximately 90 additional words woven into the card rather than a separate
generic explainer.

The Jurassic mammal card, previously truncated at the 1,024-token ceiling,
completed as a 258-word, three-page card. The sole rejection remained the kelp
card: Gemma again introduced an unsupported C$250,000 cost and also exposed
numbered-list formatting. Both problems were caught deterministically.

This improves context completeness and structural reliability. It does not by
itself solve the separate editorial problem that the Interesting and Discovery
lanes must consistently find more compelling stories.

## Editorial selector experiment

The next isolated experiment moved model judgment before full-card writing.
It scored every evidence-qualified Interesting and Discovery candidate, rather
than spending writer tokens on whichever stories happened to rank highest by
keywords. Publisher identity was hidden from the model because source trust is
a separate gate.

The comparison pool contained the 43 previously selected non-major stories and
25 qualified reserves. One reserve was excluded before scoring because fewer
than 180 characters of usable evidence remained after CSS and boilerplate were
removed. The remaining 67 candidates were scored for lane fit, substantive
value, intrinsic interest, distinctiveness, clarity, and fresh specificity.

- Candidates scored: 67
- Existing selections: 43
- Qualified reserves: 24
- Cloudflare calls: nine batches, sequential, with thinking disabled
- Complete structured evaluations: 67 of 67
- Cloudflare neurons represented by the retained complete score set: 465.51
- Automatic retries: none
- News cards generated or published: none

The first GitHub bootstrap attempt stopped at the same evidence-empty candidate,
but GitHub skipped its artifact before failure-preserving upload was added. Its
exact provider usage is therefore unavailable and is not included in 465.51;
it may have duplicated up to approximately the first seven batches. The later
resume logic prevents that waste in future interrupted runs.

The initial pass completed 63 usable evaluations before correctly stopping on
the evidence-empty reserve. A resume path reused those 63 evaluations and made
one additional four-candidate call, rather than repeating the earlier model
work. All 46 News tests pass after adding the evidence preflight and resume
coverage.

The selector found meaningful replacements. Eleven qualified reserves received
a strong recommendation, including a Hittite tablet archive, a room-temperature
nuclear clock, a 23-million-year-old plant fossil, a Ghanaian community response
to illegal mining, an Indigenous Canadian seawater-to-jet-fuel venture, and
investigative reporting from Malaysia. Seven previously selected stories were
rejected, including a routine bartender profile, a generic wetland success item,
and an Odisha craft feature with too little fresh development.

This validates model-assisted story-idea triage as a cheap step before writing,
but not yet as an automatic production decision. Two boundaries still need
deterministic or separately tested enforcement:

1. some high-scoring investigative war and geopolitical stories fit Major News
   better than the Interesting lane; and
2. a compelling idea can still originate from a source that needs stronger
   corroboration or replacement before card generation.

The blind ranking, source-bearing answer key, exact calls, latency, token usage,
and neuron usage are saved under
`review-output-five-lane/editorial-selector-trial/`. The app feed, Stage 1
pipeline, main branch, Beta, deployment, and billing were not changed.
