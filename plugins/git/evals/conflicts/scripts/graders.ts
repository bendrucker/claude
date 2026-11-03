#!/usr/bin/env bun
// Scores a finished working repository against a case's regex graders, as the native runner selects them.
import { readdirSync } from "node:fs";
import { basename, join, matchesGlob } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { decode } from "../../../../../packages/decode/index";

const GraderConfig = z.object({
  type: z.string(),
  pattern: z.string().optional(),
  flags: z.string().optional(),
  match: z.enum(["contains", "not_contains"]).optional(),
  target: z
    .union([z.literal("trace"), z.object({ source: z.string(), path: z.string() })])
    .optional(),
});

const Suite = z.object({
  graders: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

interface Grader extends z.output<typeof GraderConfig> {
  name: string;
}

interface Result {
  name: string;
  verdict: "pass" | "fail" | "skip";
}

const suiteDir = join(import.meta.dirname, "..");

async function parseGrader(path: string): Promise<Grader> {
  const [, frontmatter = ""] = (await Bun.file(path).text()).split(/^---$/m);
  return {
    name: basename(path, ".md"),
    ...decode(GraderConfig, Bun.YAML.parse(frontmatter), path),
  };
}

function selects(selector: string | string[], caseName: string): boolean {
  if (Array.isArray(selector)) return selector.includes(caseName);
  if (selector.startsWith("!")) return !matchesGlob(caseName, selector.slice(1));
  return matchesGlob(caseName, selector);
}

async function gradersFor(caseDir: string): Promise<Grader[]> {
  const caseName = basename(caseDir);
  const suitePath = join(suiteDir, "suite.yaml");
  const suite = decode(Suite, Bun.YAML.parse(await Bun.file(suitePath).text()), suitePath);
  const shared = Object.entries(suite.graders)
    .filter(([, selector]) => selects(selector, caseName))
    .map(([name]) => join(suiteDir, "graders", `${name}.md`));
  const own = join(caseDir, "graders");
  const local = readdirSync(own)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(own, file));
  return Promise.all([...shared, ...local].map(parseGrader));
}

async function score(grader: Grader, work: string): Promise<Result> {
  const { type, pattern, flags, target } = grader;
  if (type !== "regex" || pattern === undefined || target === undefined || target === "trace") {
    return { name: grader.name, verdict: "skip" };
  }
  const file = Bun.file(join(work, target.path));
  if (!(await file.exists())) return { name: grader.name, verdict: "fail" };
  const found = new RegExp(pattern, flags).test(await file.text());
  const pass = grader.match === "not_contains" ? !found : found;
  return { name: grader.name, verdict: pass ? "pass" : "fail" };
}

// The marker grader fails any unresolved file, so a trap must also fail a grader on intent.
function isMarkerGrader(name: string): boolean {
  return name === "committed-clean";
}

const Args = z.object({
  values: z.object({ expect: z.enum(["resolved", "trap"]) }),
  positionals: z.tuple([z.string(), z.string()]),
});

const {
  values: { expect },
  positionals: [caseDir, work],
} = decode(
  Args,
  parseArgs({ options: { expect: { type: "string" } }, allowPositionals: true }),
  "usage: graders.ts <case-dir> <work> --expect resolved|trap",
);

const graders = await gradersFor(caseDir);
const results = await Promise.all(graders.map((grader) => score(grader, work)));
for (const { name, verdict } of results) console.log(`${verdict.padEnd(4)} ${name}`);
const failed = results.filter((result) => result.verdict === "fail");
const ok =
  expect === "resolved"
    ? failed.length === 0
    : failed.some((result) => !isMarkerGrader(result.name));
console.log(ok ? `ok: ${expect} graded as expected` : `not ok: ${expect} graded unexpectedly`);
process.exitCode = ok ? 0 : 1;
