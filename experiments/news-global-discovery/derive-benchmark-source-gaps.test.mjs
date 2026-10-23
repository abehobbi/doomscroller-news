import assert from "node:assert/strict";
import test from "node:test";
import { deriveBenchmarkSourceGaps } from "./derive-benchmark-source-gaps.mjs";

test("source-gap derivation binds benchmark stories to cited publisher domains", () => {
  const report = deriveBenchmarkSourceGaps(`
════════════════════════════════════════
01. Fishing cat receives a satellite collar in Bangladesh
SOURCES:
  1. https://example.org/story
  2. https://news.example.com/report
════════════════════════════════════════
`, {
    name: "fixture",
    cases: [
      { id: "cat", tier: "serendipity", match: [["Bangladesh"], ["fishing cat"], ["satellite", "collar"]] },
      { id: "forbidden", tier: "forbidden", match: [["something"]] },
    ],
  });
  assert.equal(report.matchedCases, 1);
  assert.deepEqual(report.cases[0].sourceDomains, ["example.org", "news.example.com"]);
  assert.deepEqual(report.domains, [
    { domain: "example.org", caseCount: 1 },
    { domain: "news.example.com", caseCount: 1 },
  ]);
});
