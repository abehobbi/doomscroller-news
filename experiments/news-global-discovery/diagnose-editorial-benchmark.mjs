import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesBenchmarkCase, normalizeBenchmarkText } from "./audit-editorial-benchmark.mjs";

const STAGES = ["discovered", "shortlisted", "verified", "editorial", "final"];

function textFrom(value) {
  if (!value || typeof value !== "object") return "";
  return normalizeBenchmarkText([
    value.headline,
    value.title,
    value.dek,
    value.summary,
    value.evidence,
    ...(Array.isArray(value.pages) ? value.pages.map((page) => page?.text) : []),
  ].filter(Boolean).join(" "));
}

function shortlistItems(answerKey) {
  return (answerKey?.selections ?? []).flatMap((selection) => [
    selection?.representative,
    ...(Array.isArray(selection?.members) ? selection.members : []),
  ]).filter(Boolean);
}

function stageItems(artifacts) {
  return {
    discovered: artifacts.discovery?.candidates ?? [],
    shortlisted: shortlistItems(artifacts.selection),
    verified: artifacts.verified?.cards ?? artifacts.verified?.ready ?? [],
    editorial: artifacts.editorial?.cards ?? [],
    final: artifacts.final?.cards ?? [],
  };
}

export function diagnoseEditorialBenchmark(artifacts, benchmark) {
  const stages = stageItems(artifacts);
  const indexed = Object.fromEntries(
    STAGES.map((stage) => [stage, stages[stage].map((item) => ({ item, text: textFrom(item) }))]),
  );
  const cases = benchmark.cases.map((benchmarkCase) => {
    const matches = Object.fromEntries(STAGES.map((stage) => {
      const found = indexed[stage].find(({ text }) => matchesBenchmarkCase(text, benchmarkCase));
      return [stage, {
        matched: Boolean(found),
        headline: found?.item?.headline ?? found?.item?.title ?? null,
      }];
    }));
    const furthestStage = [...STAGES].reverse().find((stage) => matches[stage].matched) ?? null;
    let outcome = "not_discovered";
    if (furthestStage === "discovered") outcome = "discovered_not_shortlisted";
    if (furthestStage === "shortlisted") outcome = "shortlisted_not_verified";
    if (furthestStage === "verified") outcome = "verified_not_editorial";
    if (furthestStage === "editorial") outcome = "editorial_not_final";
    if (furthestStage === "final") outcome = "final";
    return { id: benchmarkCase.id, tier: benchmarkCase.tier, outcome, furthestStage, matches };
  });
  const outcomeCounts = Object.fromEntries(
    ["not_discovered", "discovered_not_shortlisted", "shortlisted_not_verified", "verified_not_editorial", "editorial_not_final", "final"]
      .map((outcome) => [outcome, cases.filter((item) => item.outcome === outcome).length]),
  );
  const byTier = Object.fromEntries(
    ["essential", "valuable", "serendipity", "forbidden"].map((tier) => [tier, {
      total: cases.filter((item) => item.tier === tier).length,
      final: cases.filter((item) => item.tier === tier && item.outcome === "final").length,
      notDiscovered: cases.filter((item) => item.tier === tier && item.outcome === "not_discovered").length,
    }]),
  );
  return {
    schemaVersion: 1,
    benchmark: benchmark.name,
    developmentOnly: true,
    stageCounts: Object.fromEntries(STAGES.map((stage) => [stage, stages[stage].length])),
    outcomeCounts,
    byTier,
    cases,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonIfPresent(file, fallback) {
  return fs.existsSync(file) ? readJson(file) : fallback;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run || !args.benchmark || !args.out) {
    throw new Error("Usage: node diagnose-editorial-benchmark.mjs --run <artifact-dir> --benchmark <benchmark.json> --out <report.json>");
  }
  const run = path.resolve(args.run);
  const baselineDiscovery = readJson(path.join(run, "combined", "COMBINED_DISCOVERY.json"));
  const gapDiscovery = readJsonIfPresent(path.join(run, "gap", "discovery", "EXA_GAP_DISCOVERY.json"), { candidates: [] });
  const baselineSelection = readJson(path.join(run, "selection", "ANSWER_KEY.json"));
  const gapSelection = readJsonIfPresent(path.join(run, "gap", "selection", "ANSWER_KEY.json"), { selections: [] });
  const artifacts = {
    discovery: { candidates: [...(baselineDiscovery.candidates ?? []), ...(gapDiscovery.candidates ?? [])] },
    selection: { selections: [...(baselineSelection.selections ?? []), ...(gapSelection.selections ?? [])] },
    verified: readJson(path.join(run, "merged", "MERGED_VERIFIED_EDITION.json")),
    editorial: readJson(path.join(run, "editorial", "EDITORIAL_VERIFIED_EDITION.json")),
    final: readJson(path.join(run, "final", "UNATTENDED_SHADOW_EDITION.json")),
  };
  const report = diagnoseEditorialBenchmark(artifacts, readJson(args.benchmark));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
