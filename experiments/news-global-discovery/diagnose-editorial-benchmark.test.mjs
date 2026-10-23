import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseEditorialBenchmark } from "./diagnose-editorial-benchmark.mjs";

const benchmark = {
  name: "stage diagnosis fixture",
  cases: [
    { id: "never", tier: "essential", match: [["missing comet"]] },
    { id: "discovered", tier: "valuable", match: [["river otter"]] },
    { id: "shortlisted", tier: "valuable", match: [["bronze workshop"]] },
    { id: "verified", tier: "serendipity", match: [["forest fungus"]] },
    { id: "editorial", tier: "serendipity", match: [["desert flower"]] },
    { id: "final", tier: "essential", match: [["fishing cat"]] },
  ],
};

test("diagnosis identifies the furthest pipeline stage for each benchmark story", () => {
  const result = diagnoseEditorialBenchmark({
    discovery: { candidates: [
      { title: "River otter returns" },
      { title: "Bronze workshop found" },
      { title: "Forest fungus mapped" },
      { title: "Desert flower blooms" },
      { title: "Fishing cat tracked" },
    ] },
    selection: { selections: [
      { representative: { title: "Bronze workshop found" }, members: [] },
      { representative: { title: "Forest fungus mapped" }, members: [] },
      { representative: { title: "Desert flower blooms" }, members: [] },
      { representative: { title: "Fishing cat tracked" }, members: [] },
    ] },
    verified: { cards: [
      { headline: "Forest fungus mapped" },
      { headline: "Desert flower blooms" },
      { headline: "Fishing cat tracked" },
    ] },
    editorial: { cards: [
      { headline: "Desert flower blooms" },
      { headline: "Fishing cat tracked" },
    ] },
    final: { cards: [{ headline: "Fishing cat tracked" }] },
  }, benchmark);

  assert.deepEqual(result.cases.map(({ id, outcome }) => [id, outcome]), [
    ["never", "not_discovered"],
    ["discovered", "discovered_not_shortlisted"],
    ["shortlisted", "shortlisted_not_verified"],
    ["verified", "verified_not_editorial"],
    ["editorial", "editorial_not_final"],
    ["final", "final"],
  ]);
  assert.equal(result.outcomeCounts.final, 1);
  assert.equal(result.byTier.essential.notDiscovered, 1);
});
