#!/usr/bin/env bun
// Runs inside a case fixture, where the staged tree has no node_modules, so it imports only builtins.
import { globSync } from "node:fs";
import { join } from "node:path";

interface Grader {
  name: string;
  passed: boolean;
  weight: number;
  scored: boolean;
  withOnly: boolean;
}
interface Run {
  score: number | null;
  passed: boolean;
  graders: Grader[];
}
interface Result {
  claudeVersion: string;
  cases: { name: string; model: string; runsPerCase: number; arms: Record<string, Run[]> }[];
}

const SECOND_BASELINE = "35951681721";
function isResult(v: unknown): v is Result {
  return typeof v === "object" && v !== null && "cases" in v && Array.isArray(v.cases);
}

function isPull(v: unknown): v is { body: string } {
  return typeof v === "object" && v !== null && "body" in v && typeof v.body === "string";
}

/** The `show-me-stop` seed's candidate and holdout-candidate run ids, as its body links them. */
const CANDIDATE = new Set(["35952318935", "35952324529"]);
const HOLDOUT_CANDIDATE = new Set(["35952866833", "35952879887"]);

function rescore(run: Run, arm: string): void {
  const counted = run.graders.filter((g) => g.scored && (arm === "with" || !g.withOnly));
  const total = counted.reduce((s, g) => s + g.weight, 0);
  if (total === 0) return;
  run.score = counted.reduce((s, g) => s + (g.passed ? g.weight : 0), 0) / total;
  run.passed = counted.every((g) => g.passed);
}

const TREE: Partial<Record<string, (dir: string) => Promise<void>>> = {
  async leakage(dir) {
    const path = join(dir, "user/skills/show-me/SKILL.md");
    const text = await Bun.file(path).text();
    const from = "such as stubs, latent bugs, open decisions, or an offer to build it";
    const to =
      "such as stubs, latent bugs, open decisions, how to invalidate one SKU in a price cache, or an offer to build it";
    if (!text.includes(from)) throw new Error("leakage: anchor missing");
    await Bun.write(path, text.replace(from, to));
  },
  async "grader-edit"(dir) {
    const paths = globSync("evals/user/show-me/*/graders/short-close.md", { cwd: dir });
    await Promise.all(
      paths.map(async (p) => {
        const text = await Bun.file(join(dir, p)).text();
        await Bun.write(join(dir, p), text.replaceAll(/\b500\b/g, "1500"));
      }),
    );
  },
};

const BODY: Partial<Record<string, (body: string) => string>> = {
  "grader-edit": (body) =>
    body.replace(
      "both columns regraded against the suite's current graders",
      "the baseline from the suite commit and the candidate from this branch",
    ),
  unregistered: (body) => body.replace(/#### Hypothesis\n[\s\S]*?(?=#### Result)/, ""),
};

const RUNS: Partial<Record<string, (id: string, result: Result) => void>> = {
  noise(id, result) {
    if (id !== SECOND_BASELINE) return;
    for (const c of result.cases) {
      for (const run of c.arms.with ?? []) {
        for (const g of run.graders) if (g.name === "short-close") g.passed = true;
        rescore(run, "with");
      }
    }
  },
  drift(id, result) {
    if (!CANDIDATE.has(id)) return;
    for (const c of result.cases) {
      for (const run of c.arms.without ?? []) {
        for (const g of run.graders) g.passed = true;
        rescore(run, "without");
      }
    }
  },
  "holdout-fell"(id, result) {
    if (!HOLDOUT_CANDIDATE.has(id)) return;
    for (const c of result.cases) {
      for (const [i, run] of (c.arms.with ?? []).entries()) {
        const scored = run.graders.filter((g) => g.scored && g.name !== "short-close");
        const close = run.graders.find((g) => g.name === "short-close");
        if (close) close.passed = false;
        const second = scored[i % Math.max(scored.length, 1)];
        if (second) second.passed = false;
        rescore(run, "with");
      }
    }
  },
  versions(id, result) {
    if (!CANDIDATE.has(id)) return;
    result.claudeVersion = "2.1.290";
    for (const c of result.cases) c.model = "claude-sonnet-5-5";
  },
};

async function tree(plant: string, dir: string): Promise<void> {
  await TREE[plant]?.(dir);
}

async function data(plant: string, seed: string, dir: string, base: string, head: string) {
  const edit = RUNS[plant];
  const paths = globSync("runs/*/aggregate-result.json", { cwd: seed });
  await Promise.all(
    paths.map(async (p) => {
      const result: unknown = await Bun.file(join(seed, p)).json();
      if (!isResult(result)) throw new Error(`${p} lacks cases`);
      edit?.(p.split("/")[1] ?? "", result);
      await Bun.write(join(dir, p), `${JSON.stringify(result)}\n`);
    }),
  );
  const pr: unknown = await Bun.file(join(seed, "pr.json")).json();
  if (!isPull(pr)) throw new Error(`${seed}/pr.json lacks a body`);
  const body = BODY[plant]?.(pr.body) ?? pr.body;
  const meta = {
    root: dir,
    repo: "bendrucker/claude",
    viewer: "bendrucker",
    base,
    head,
    pull: { ...pr, body },
    reviews: [],
    threads: [],
  };
  await Bun.write(join(process.env.HOME ?? "", ".eval-stubs/meta.json"), JSON.stringify(meta));
}

const [phase, plant = "none", seed = "", dir = ".", base = "", head = ""] = process.argv.slice(2);
if (phase === "tree") await tree(plant, dir);
else if (phase === "data") await data(plant, seed, dir, base, head);
else throw new Error(`usage: plant.ts tree|data <plant> <seed> <dir> [<base> <head>]`);
