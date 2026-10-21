import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.,%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cardText(card) {
  return normalize([
    card?.headline,
    card?.title,
    card?.dek,
    card?.summary,
    ...(Array.isArray(card?.pages) ? card.pages.map((page) => page?.text) : []),
  ].filter(Boolean).join(" "));
}

function matchesCase(text, benchmarkCase) {
  return benchmarkCase.match.every((alternatives) =>
    alternatives.some((term) => text.includes(normalize(term))),
  );
}

export function auditEditorialBenchmark(edition, benchmark) {
  const cards = Array.isArray(edition?.cards) ? edition.cards : [];
  const indexed = cards.map((card) => ({ card, text: cardText(card) }));
  const results = benchmark.cases.map((benchmarkCase) => {
    const found = indexed.find(({ text }) => matchesCase(text, benchmarkCase));
    return {
      id: benchmarkCase.id,
      tier: benchmarkCase.tier,
      matched: Boolean(found),
      matchedHeadline: found?.card?.headline ?? found?.card?.title ?? null,
    };
  });

  const recall = Object.fromEntries(
    ["essential", "valuable", "serendipity"].map((tier) => {
      const tierResults = results.filter((result) => result.tier === tier);
      const matched = tierResults.filter((result) => result.matched).length;
      return [tier, { matched, total: tierResults.length, rate: tierResults.length ? matched / tierResults.length : 1 }];
    }),
  );
  const forbiddenMatches = results.filter((result) => result.tier === "forbidden" && result.matched);
  const thresholds = benchmark.thresholds;
  const passes =
    recall.essential.rate >= thresholds.essentialRecall &&
    recall.valuable.rate >= thresholds.valuableRecall &&
    recall.serendipity.rate >= thresholds.serendipityRecall &&
    forbiddenMatches.length <= thresholds.maximumForbiddenMatches;

  return {
    schemaVersion: 1,
    benchmark: benchmark.name,
    developmentOnly: true,
    passes,
    cardCount: cards.length,
    recall,
    forbiddenMatches,
    misses: results.filter((result) => result.tier !== "forbidden" && !result.matched),
    results,
  };
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
  if (!args.edition || !args.benchmark || !args.out) {
    throw new Error("Usage: node audit-editorial-benchmark.mjs --edition <edition.json> --benchmark <benchmark.json> --out <report.json>");
  }
  const edition = JSON.parse(fs.readFileSync(args.edition, "utf8"));
  const benchmark = JSON.parse(fs.readFileSync(args.benchmark, "utf8"));
  const report = auditEditorialBenchmark(edition, benchmark);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passes) process.exitCode = 1;
}
