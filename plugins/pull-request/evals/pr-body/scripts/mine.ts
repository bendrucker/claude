#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../../../packages/decode/index";

// Mine PR bodies authored via Claude Code sessions. The session index's
// pr_links table maps sessions to the PRs they opened; the bodies themselves
// live on GitHub, fetched per-repo via `gh pr list`.
//
// Egress rule: the index includes an imported `work` host marked block-egress,
// and work PR bodies live on private hosts anyway. The SQL below is hardcoded
// to host = 'local' and public bendrucker/* repos; keep it that way.

export const MinedPr = z.looseObject({
  repository: z.string(),
  pr_number: z.number(),
  url: z.string(),
  session_id: z.string(),
});
export type MinedPr = z.infer<typeof MinedPr>;

export const FetchedPr = z.looseObject({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  state: z.string(),
  createdAt: z.string(),
});
export type FetchedPr = z.infer<typeof FetchedPr>;

export interface Item {
  id: string;
  repo: string;
  pr_number: number;
  url: string;
  title: string;
  state: string;
  created_at: string;
  session_id: string;
  size: "compact" | "full";
  body: string;
}

const SQL = `
SELECT repository,
  pr_number,
  min(url) AS url,
  CAST(min(timestamp) AS VARCHAR) AS opened_at,
  arg_min(session_id, timestamp) AS session_id
FROM pr_links
WHERE host = 'local'
  AND repository LIKE 'bendrucker/%'
GROUP BY repository, pr_number
ORDER BY repository, pr_number
`;

export function sizeOf(body: string): "compact" | "full" {
  return body.length < 1200 ? "compact" : "full";
}

export function toItem(mined: MinedPr, fetched: FetchedPr): Item {
  return {
    id: "",
    repo: mined.repository,
    pr_number: mined.pr_number,
    url: fetched.url !== "" ? fetched.url : mined.url,
    title: fetched.title,
    state: fetched.state,
    created_at: fetched.createdAt,
    session_id: mined.session_id,
    size: sizeOf(fetched.body),
    body: fetched.body,
  };
}

// Interleave longest and shortest so a truncated labeling session still spans
// both the sectioned long-form bodies and the tight one-paragraph ones.
export function weave<T>(items: T[], length: (item: T) => number): T[] {
  const sorted = items.toSorted((a, b) => length(b) - length(a));
  const woven: T[] = [];
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const first = sorted[lo++];
    if (first !== undefined) woven.push(first);
    if (lo <= hi) {
      const last = sorted[hi--];
      if (last !== undefined) woven.push(last);
    }
  }
  return woven;
}

// Repo-balanced round-robin so one high-traffic repo doesn't crowd out the
// rest of the sample.
export function selectSample(candidates: Item[], limit: number): Item[] {
  const buckets = new Map<string, Item[]>();
  for (const c of candidates) {
    const arr = buckets.get(c.repo) ?? [];
    arr.push(c);
    buckets.set(c.repo, arr);
  }
  for (const [repo, arr] of buckets) {
    buckets.set(
      repo,
      weave(arr, (i) => i.body.length),
    );
  }
  const order = [...buckets.keys()].toSorted();
  const selected: Item[] = [];
  let added = true;
  while (added && selected.length < limit) {
    added = false;
    for (const repo of order) {
      const next = buckets.get(repo)?.shift();
      if (next && selected.length < limit) {
        selected.push(next);
        added = true;
      }
    }
  }
  selected.forEach((s, i) => {
    s.id = `pr-${String(i + 1).padStart(3, "0")}`;
  });
  return selected;
}

function resolveDbPath(db: string | undefined): string {
  if (db != null && db !== "") return db;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  const tmp = process.env.TMPDIR;
  const dataDir =
    pluginData != null && pluginData !== ""
      ? pluginData
      : join(tmp != null && tmp !== "" ? tmp : "/tmp", "claude-session");
  return join(dataDir, "session.duckdb");
}

async function queryMined(dbPath: string): Promise<MinedPr[]> {
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath], {
    stdin: new TextEncoder().encode(SQL),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`duckdb failed (${code}): ${err.trim()}`);
  const trimmed = out.trim();
  if (trimmed === "") return [];
  return decodeJson(z.array(MinedPr), trimmed, `duckdb ${dbPath}`);
}

async function fetchRepoPrs(repo: string): Promise<Map<number, FetchedPr>> {
  const proc = Bun.spawn(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      repo,
      "--author",
      "bendrucker",
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,body,url,state,createdAt,author",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh pr list --repo ${repo} failed (${code}): ${err.trim()}`);
  const prs = decodeJson(z.array(FetchedPr), out, `gh pr list --repo ${repo}`);
  return new Map(prs.map((pr) => [pr.number, pr]));
}

async function main() {
  const argv = cli({
    name: "mine",
    help: {
      description: "Mine PR bodies opened from local Claude Code sessions into a labelable set.",
    },
    flags: {
      db: {
        type: String,
        description: "session.duckdb path (defaults to the session skill's data dir)",
      },
      out: {
        type: String,
        default: join(import.meta.dirname, "..", "data", "samples.json"),
        description: "Output path for the labelable sample",
      },
      limit: { type: Number, default: 50, description: "Max items to keep" },
      minChars: { type: Number, default: 40, description: "Drop bodies shorter than this" },
    },
  });

  const dbPath = resolveDbPath(argv.flags.db);
  if (!(await Bun.file(dbPath).exists())) {
    console.error(`No session index at ${dbPath}.`);
    console.error("Build it first: bun plugins/claude-code/skills/session/scripts/refresh.ts");
    process.exit(1);
  }

  const mined = await queryMined(dbPath);
  console.log(`Session index: ${mined.length} distinct local bendrucker/* PRs`);

  const repos = [...new Set(mined.map((m) => m.repository))].toSorted();
  const fetched = new Map<string, Map<number, FetchedPr>>();
  for (const repo of repos) {
    // oxlint-disable-next-line no-await-in-loop -- each repo is a paginated GitHub API sweep; serializing keeps the run inside the REST rate limit.
    fetched.set(repo, await fetchRepoPrs(repo));
  }

  const candidates: Item[] = [];
  let missing = 0;
  let short = 0;
  for (const m of mined) {
    const pr = fetched.get(m.repository)?.get(m.pr_number);
    if (!pr) {
      missing++;
      continue;
    }
    if (pr.body.trim().length < argv.flags.minChars) {
      short++;
      continue;
    }
    candidates.push(toItem(m, pr));
  }

  const selected = selectSample(candidates, argv.flags.limit);

  await mkdir(dirname(argv.flags.out), { recursive: true });
  await Bun.write(argv.flags.out, `${JSON.stringify(selected, null, 2)}\n`);

  const byRepo: Record<string, number> = {};
  for (const s of selected) byRepo[s.repo] = (byRepo[s.repo] ?? 0) + 1;

  console.log(
    `Candidates: ${candidates.length} (${missing} not found on GitHub, ${short} below --min-chars)`,
  );
  console.log(`Wrote ${selected.length} samples to ${argv.flags.out}`);
  for (const [repo, n] of Object.entries(byRepo)) console.log(`  ${repo}: ${n}`);
}

if (import.meta.main) await main();
