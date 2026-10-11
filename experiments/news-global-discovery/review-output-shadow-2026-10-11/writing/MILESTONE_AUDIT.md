# Fresh 20-card shadow edition — milestone audit

This is an isolated News experiment. It did not update Doomscroller, main, Beta, deployment, or the Stage 1 feed.

## Outcome

- 20 of 20 requested cards returned complete structured output with no truncation.
- After correcting the deterministic number checker, 19 of 20 pass the structural, date, relative-time, numeric-evidence, qualifier-preservation, and headline-overlap checks.
- The four original numeric rejections were checker false positives: `94%` versus “ninety-four percent,” `44,457 people` with an intervening descriptor in the evidence, and `17 years` / `30 years` versus written-number equivalents.
- One genuine wording problem remains in the Bangladesh flood headline: it says `1 million affected`, while the evidence says **more than** one million. The body preserves the qualifier. The new qualifier audit correctly rejects this card until the headline is fixed.
- Model use for the 20 cards was 606.1727 Cloudflare neurons, 45,637 input tokens, 7,526 output tokens, and 150,076 ms of provider latency.
- The complete milestone, including discovery and selection, used $0.448 of Exa search credit and about 1,508.182 Cloudflare neurons.

## Editorial audit

### Strong enough to retain for further product testing

1. Riyadh airport attack
2. Gaza ceasefire anniversary and humanitarian conditions
3. EU–China preliminary trade agreement
4. Toronto bike-lane removal
5. Syria considering military assistance to Saudi Arabia — attribution and denial are preserved
6. Lucknow’s threatened silver nagra craft
7. West Bank checkpoint-information Telegram channel
8. Dixcove fishermen opposing offshore gold exploration in Ghana
9. Padma River erosion threatening a school in Shariatpur, Bangladesh
10. The distant fast radio burst

These still need ordinary human copy review before a production release; “retain” is not an assertion that every sentence is final.

### Retain, but revise the generated copy

1. **India Gen-Z protest:** the final sentence attributes the security deployment broadly to Prime Minister Modi’s government even though the packet more directly supports actions by Delhi authorities and police. Keep the event, tighten that attribution.
2. **Bangladesh floods:** restore “more than” in the headline and retain the more precise 1.022 million figure in the body.
3. **Al-Shaddadi base:** use **Hasakah Governorate**, not “Hasakah province,” in accordance with the product’s Syria geography convention.
4. **Polish codebreaker:** rewrite the confusing sentence “After Syria was lost following the invasion of France.” The supplied history may support the underlying sequence, but this rendering is not understandable enough to publish.
5. **Madagascar seaweed farming:** lead with the human and environmental tension instead of “An interdisciplinary study examines…”. The current headline and opening sound academic and conceal why the story is interesting.
6. **Japan bear-repellent drones:** replace “until approximately when bears enter hibernation” with natural prose while preserving the source’s uncertainty.
7. **Eskasoni e-fuel pilot:** orient the reader with “Sydney harbour, Nova Scotia” rather than only “Sydney harbour, Canada.”

### Hold for stronger source or freshness review

1. **Nord Stream trial:** the displayed BBC `.com` and `.co.uk` links are one publisher family, and the Al Jazeera support is older context. The event and card may be valid, but the production gate should not describe this as three independent current reports.
2. **Sudanese refugees in Chad:** the primary discovery URL appears to reproduce or relay reporting, while the displayed Guardian support is from 2025. Verify the current original report and event freshness before publishing.
3. **Madagascar seaweed study:** replace the derivative science page with the original paper or institutional research release before production.
4. **Hittite archive:** obtain the excavation authority’s announcement or a second strong independent source rather than relying on one newspaper account.

## What this proves

The five-lane architecture can discover, select, source-check, and write a varied 20-card edition at a sustainable free-tier cost. It also proves that complete JSON and passing deterministic checks are not enough: a final editorial gate must check source lineage, freshness, qualifiers, geographic wording, natural prose, and whether the headline exposes the genuinely interesting fact.

## Recommended next milestone

Do not publish this edition. Add deterministic checks for lost qualifiers and duplicated source families, strengthen original-source recovery for science and relayed features, and run a small targeted rewrite only for the retained cards listed above. Then present the corrected 20-card edition for human review with headline, location, lane, image, full card text, and sources.
