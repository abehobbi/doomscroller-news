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

## Lane-boundary and source-readiness safeguards

A separate isolated pass evaluated the 43 non-rejected Interesting candidates
against an explicit Major News versus Interesting boundary. It used the saved
evidence, not model memory, and did not regenerate any card.

- Candidates classified: 43
- Complete structured decisions: 43 of 43
- Cloudflare batches: 6
- Cloudflare neurons: 278.30
- Input tokens: 21,709
- Output tokens: 2,968
- Automatic retries: none

Seventeen stories were reassigned from Interesting to their corresponding Major
News lane. These included the Nord Stream investigation, the false Anthropic
homicide tip, the ICE detention investigation, Operation Vivaldi, the Syrian
Oscar selection, attacks and protests in Syria, Ghanaian mining damage, and a
Brampton election-integrity dispute. Twenty-six retained their Interesting
classification because their central value was a grounded human, place,
livelihood, cultural, or unusual-local-solution perspective.

The same pass attached a deterministic source state to all 67 scored stories:

- provisionally usable: 26
- needs independent corroboration: 14
- needs independent context: 9
- needs publisher review: 14
- replace the current source: 4

These labels are gates, not quality scores. A fascinating story does not bypass
source verification, and a reputable publisher does not make a contested
single-source allegation independently confirmed.

Fifteen strong non-major stories requiring source work then received one
targeted Exa search each. The run cost exactly $0.105 according to Exa. After
collapsing duplicate URLs from the same domain into one source family:

- five found one trusted supporting source family;
- one found two trusted supporting source families; and
- nine remained unresolved under the strict relevance, evidence, and trusted-
  domain rules.

Useful results included NASA support for the distant fast-radio-burst story,
NOIRLab support for the gravitational-lens map, University of Chicago support
for the Jurassic mammal, Yale support for the uncertainty study, two Ghanaian
outlets covering the community arrest of suspected illegal miners, and Mongabay
coverage of the Canadian kelp-restoration work. Unresolved does not mean false;
it means the automated path did not find adequate support and the story must not
advance automatically.

The first local verification attempt terminated before it wrote a checkpoint,
so its exact credit use is unavailable and may include some partial duplicate
searches. The verifier now checkpoints after every story, resumes completed
work, isolates individual search failures, and counts source families rather
than raw URLs. All 54 News tests pass. The app, main, Beta, deployment, and
billing remain unchanged.

## Deterministic writer-ready shortlist

The qualified Major pool, editorially scored candidates, lane-boundary results,
and targeted source-verification results were then combined by stable event ID.
This was an offline deterministic step: it made no model or search calls and
did not generate any News card.

A candidate can advance only when its source state is satisfied. Established
low-risk reporting may advance provisionally. Contested claims need at least
two independent source families. Specialist or research reporting needs an
independent contextual source. An unregistered publisher needs independent
support, and a weak or derivative publisher needs a trusted replacement.
Unresolved candidates are withheld with an explicit reason rather than quietly
entering the writer.

The selector keeps all ready strong recommendations, preserves the already
qualified Major pool when its source gate passes, and uses `possible` stories
only when required to approach a lane minimum. It does not pad a lane after the
minimum has been met. Lane maximums and the 65-card daily hard cap are enforced.

The current writer-ready manifest contains 30 stories:

- world-interesting: 9 (minimum 10 not met)
- priority-interesting: 6 (minimum 6 met)
- world-major: 5 (minimum 10 not met)
- priority-major: 5 (minimum 8 not met)
- discovery: 5 (minimum 4 met)

Forty-eight candidates are withheld or held as unnecessary `possible` reserve
stories. The source blockers include 24 contested claims without a second
independent source family, 14 unverified publishers without support, four
specialist stories without independent context, and three weak sources without
a trusted replacement. The remaining three are ready `possible` stories that
were not needed after their lane minimum was reached.

The underfilled lanes are intentional evidence, not a failure to count. This
trial pool cannot safely produce the requested full daily range without more
source retrieval, especially for Major News. The next production experiment
should therefore improve source acquisition for the best withheld Major stories
before spending writer tokens. The exact ready and withheld lists are saved in
`review-output-five-lane/writer-ready-shortlist/`. The app, main branch, Beta,
deployment, and billing remain unchanged.

## Targeted Major News source acquisition

The verifier was extended to consume the withheld writer-shortlist candidates,
retain their stable event IDs, prioritize strong rerouted Major stories before
the baseline Major pool, and checkpoint after every search. Existing completed
verification can now be combined with a later verification batch without
repeating searches.

Twelve Major candidates received one Exa search each. The exact reported cost
was $0.084. No automatic retries were made.

- three candidates found two trusted supporting source families;
- two candidates found one trusted supporting source family; and
- seven remained unresolved.

The successfully advanced events were the Nord Stream investigation, the false
Anthropic homicide tip, Syria's destruction of chemical-weapons remnants,
Bangladesh flooding, and United States sanctions on the International Criminal
Court. Examples of useful additional sources included BBC, The Guardian, the
United Nations, The Business Standard, the ICC, and Al Jazeera. An unresolved
search still means only that the strict automated search did not find adequate
support; it is not a factual rejection.

Rebuilding the deterministic manifest increased the writer-ready pool from 30
to 35 stories:

- world-interesting: 9
- priority-interesting: 6
- world-major: 8
- priority-major: 7
- discovery: 5

Priority Interesting and Discovery meet their minimums. World Major is now two
short, Priority Major one short, and World Interesting one short. Those gaps are
preserved rather than filled with unsupported or merely `possible` stories.
All 61 News tests pass. No News card was generated, and the app, main branch,
Beta, deployment, and billing remain unchanged.

## Exact gap-recovery pass

A deterministic gap selector calculated the remaining deficit in every lane,
excluded every event already sent to source verification, and requested only
enough new candidates to fill the four outstanding positions. It selected one
World Interesting candidate, two World Major candidates, and one Priority Major
candidate. This prevented an open-ended search loop and prevented unresolved
stories from being retried automatically.

The four Exa searches cost exactly $0.028. Hurricane Isaias gained supporting
National Hurricane Center evidence, and the Syrian army's takeover of the
al-Shaddadi base gained supporting Al Jazeera coverage. The Putin–Trump talks
story and the Korean bamboo-weir anchovy story remained unresolved under the
strict automated checks and were not advanced.

The final manifest for this milestone contains 37 writer-ready stories:

- world-interesting: 9 (one below minimum)
- priority-interesting: 6 (minimum met)
- world-major: 9 (one below minimum)
- priority-major: 8 (minimum met)
- discovery: 5 (minimum met)

The remaining two gaps are intentionally preserved. Continuing to spend search
credits merely to make the counters turn green would weaken the evidence-first
policy. All 63 News tests pass. No card was generated, and the app, main branch,
Beta, deployment, and billing remain unchanged.

## Writer-ready five-card trial

One evidence-backed candidate from each lane was selected for a controlled
writer trial. Multi-source candidates were preferred, and Syria received the
highest priority when the priority-Major candidates were otherwise tied. The
five packets covered Nord Stream, Syria's chemical-weapons cleanup, Canadian
kelp restoration, Ghanaian community action against illegal mining, and the
most distant identified fast-radio-burst host galaxy.

The trial ran through the existing manual GitHub workflow because the saved
free Cloudflare credentials remain repository secrets rather than local files.
It used Gemma 4 26B with thinking explicitly disabled, a 1,536-token completion
ceiling, structured JSON output, sequential calls, per-card checkpoints, and no
automatic retries.

- cards generated: 5
- structurally complete cards: 5
- accepted after the corrected deterministic audits: 4
- rejected: 1
- total neurons: 154.68
- input tokens: 11,482
- output tokens: 1,887
- provider latency: 41.40 seconds

The Syria, kelp, Ghana and fast-radio-burst cards passed the structure, exact-
date, relative-time, number and headline gates. They ranged from 198 to 315
words and used two or three pages.

The first audit initially rejected the kelp card because its evidence said
"almost a quarter of a million Canadian dollars" while the card said "nearly
250,000 Canadian dollars." This was a deterministic false positive: the amount
and approximation are equivalent. The numeric gate now recognizes the narrow
quarter-, half-, and three-quarter-million equivalences only when both the
source and generated prose preserve approximation. It still rejects an
unqualified exact amount.

The Nord Stream card was correctly rejected after a new relative-time audit
found the unsupported phrase "next week." That schedule was absent from the
writer packet and would also age badly in an installed feed. The relative-time
gate now rejects unsupported tomorrow/tonight and next/last/this week, month or
year wording. No retry was made.

This result supports the five-lane writer configuration but does not yet justify
full-edition generation. The next writer improvement should explicitly suppress
unsupported relative timing, then repeat only a small targeted case rather than
regenerating the five accepted/reviewed cards. The complete writer packets,
provider diagnostics, generated prose and audits are stored under
`review-output-five-lane/writer-trial/`. The app, main branch, Beta, deployment,
and billing remain unchanged.
