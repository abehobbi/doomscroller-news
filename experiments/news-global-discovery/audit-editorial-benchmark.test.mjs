import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { auditEditorialBenchmark } from "./audit-editorial-benchmark.mjs";

const benchmark = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-20-independent-editorial-benchmark.json", import.meta.url),
  "utf8",
));

const october23GapBenchmark = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-23-chatgpt-gap-benchmark.json", import.meta.url),
  "utf8",
));

test("October 20 benchmark is frozen, development-only, and balanced", () => {
  assert.equal(benchmark.developmentOnly, true);
  assert.equal(benchmark.cases.filter((item) => item.tier === "essential").length, 10);
  assert.equal(benchmark.cases.filter((item) => item.tier === "valuable").length, 10);
  assert.equal(benchmark.cases.filter((item) => item.tier === "serendipity").length, 10);
  assert.equal(benchmark.cases.filter((item) => item.tier === "forbidden").length, 4);
  assert.equal(new Set(benchmark.cases.map((item) => item.id)).size, benchmark.cases.length);
});

test("benchmark audit measures tiered recall and catches filler", () => {
  const result = auditEditorialBenchmark({ cards: [
    { headline: "Nigeria confirms first Ebola patient" },
    { headline: "Bangladesh releases fishing cat with satellite collar" },
    { headline: "Officials unveil a new borehole" },
  ] }, benchmark);

  assert.equal(result.recall.essential.matched, 1);
  assert.equal(result.recall.serendipity.matched, 1);
  assert.equal(result.forbiddenMatches.length, 1);
  assert.equal(result.passes, false);
});

test("October 23 gap benchmark freezes every ChatGPT-only comparison story", () => {
  assert.equal(october23GapBenchmark.developmentOnly, true);
  assert.match(october23GapBenchmark.purpose, /must not be used as a production query list/i);
  assert.equal(october23GapBenchmark.cases.filter((item) => item.tier === "essential").length, 28);
  assert.equal(october23GapBenchmark.cases.filter((item) => item.tier === "valuable").length, 11);
  assert.equal(october23GapBenchmark.cases.filter((item) => item.tier === "serendipity").length, 9);
  assert.equal(october23GapBenchmark.cases.length, 48);
  assert.equal(new Set(october23GapBenchmark.cases.map((item) => item.id)).size, 48);
  assert.ok(october23GapBenchmark.cases.every((item) => item.match.length >= 2));
});
