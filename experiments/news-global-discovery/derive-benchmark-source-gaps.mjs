import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesBenchmarkCase, normalizeBenchmarkText } from "./audit-editorial-benchmark.mjs";

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function deriveBenchmarkSourceGaps(editionText, benchmark) {
  const sections = editionText.split(/═{20,}/u).map((section) => section.trim()).filter(Boolean);
  const cases = benchmark.cases.filter((item) => item.tier !== "forbidden").map((benchmarkCase) => {
    const section = sections.find((item) => matchesBenchmarkCase(normalizeBenchmarkText(item), benchmarkCase));
    const urls = section?.match(/https?:\/\/[^\s)\]]+/gu)?.map((url) => url.replace(/[.,;]+$/u, "")) ?? [];
    return {
      id: benchmarkCase.id,
      tier: benchmarkCase.tier,
      matchedEditionSection: Boolean(section),
      title: section?.split(/\r?\n/u)[0]?.replace(/^\d+\.\s*/u, "") ?? null,
      sourceUrls: urls,
      sourceDomains: [...new Set(urls.map(domainFromUrl).filter(Boolean))],
    };
  });
  const domainCounts = new Map();
  for (const item of cases) {
    for (const domain of item.sourceDomains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  return {
    schemaVersion: 1,
    developmentOnly: true,
    benchmark: benchmark.name,
    matchedCases: cases.filter((item) => item.matchedEditionSection).length,
    unmatchedCases: cases.filter((item) => !item.matchedEditionSection).map((item) => item.id),
    domains: [...domainCounts.entries()]
      .map(([domain, caseCount]) => ({ domain, caseCount }))
      .sort((a, b) => b.caseCount - a.caseCount || a.domain.localeCompare(b.domain)),
    cases,
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
    throw new Error("Usage: node derive-benchmark-source-gaps.mjs --edition <edition.txt> --benchmark <benchmark.json> --out <report.json>");
  }
  const report = deriveBenchmarkSourceGaps(
    fs.readFileSync(args.edition, "utf8"),
    JSON.parse(fs.readFileSync(args.benchmark, "utf8")),
  );
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
