import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { shardJudge, type ShardJudge } from "../../../judge/adapter";
import type { ShardComment, WrittenJob } from "../../../judge/job";
import type { Verdict } from "../../../judge/schema";
import { apply, type ApplyOptions, type ApplyResult } from "./apply";
import type { AuditIo } from "./io";
import { preflight, type PreflightOptions } from "./preflight";

const TS_SOURCE = [
  "// increment the counter",
  "let counter = 0;",
  "counter += 1;",
  "",
  "/**",
  " * Retries are capped at three because the upstream limiter resets every ten",
  " * seconds and a fourth attempt always lands inside the same window.",
  " */",
  "export function retry(): void {}",
  "",
  "// This is a robust, production-grade helper that carefully handles the config.",
  "export const config = { retries: 3 };",
  "",
].join("\n");

const PY_SOURCE = [
  "# Parse the header line, then validate each field against the schema. The",
  "# validation runs before parsing the body so a bad header fails fast.",
  "def parse():",
  "    return 1",
  "",
].join("\n");

/** The scripted judge: one verdict per fixture comment, matched on a distinctive substring. */
const SCRIPT: [needle: string, verdict: Verdict][] = [
  [
    "// increment the counter",
    {
      action: "trim",
      category: "restate-the-what",
      confidence: "high",
      rationale: "Paraphrases the increment below it.",
      rewrite: null,
    },
  ],
  [
    "Retries are capped",
    {
      action: "keep",
      category: null,
      confidence: "high",
      rationale: "Explains a limit the code cannot.",
      rewrite: null,
    },
  ],
  [
    "// This is a robust",
    {
      action: "rewrite",
      category: "voice",
      confidence: "medium",
      rationale: "Names the shared config under praise.",
      rewrite: "// Retry config shared by every client.",
    },
  ],
  [
    "# Parse the header line",
    {
      action: "trim",
      category: "restate-the-what",
      confidence: "medium",
      rationale: "The ordering fact survives, the narration goes.",
      rewrite: null,
      trimTo: "# Validate the header before the body so a bad header fails fast.",
    },
  ],
];

function verdictFor(comment: ShardComment): Verdict {
  const hit = SCRIPT.find(([needle]) => comment.text.includes(needle));
  if (!hit) throw new Error(`No scripted verdict for ${comment.path}: ${comment.text}`);
  return hit[1];
}

const scripted: ShardJudge = (comments) => Promise.resolve(comments.map(verdictFor));

interface Capture {
  io: AuditIo;
  out: string[];
  err: string[];
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { log: (line) => out.push(line), warn: (line) => err.push(line) }, out, err };
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (text: string) => text.replaceAll(ANSI, "");

/** The message a promise rejects with. Fails the test if it resolves. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

let root: string;
let repo: string;
let jobs: string;
let prevCwd: string;

const git = (...args: string[]) =>
  $`git ${args}`
    .cwd(repo)
    .env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" })
    .quiet();

async function commitAll(message: string): Promise<void> {
  await git("add", "-A");
  await git("commit", "-q", "-m", message);
}

/** A repo whose second commit introduces the two fixture files, so `--base HEAD~1` scopes to them. */
beforeEach(async () => {
  prevCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "comments-audit-"));
  repo = join(root, "repo");
  jobs = join(root, "jobs");
  await mkdir(repo);
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await Bun.write(join(repo, "README.md"), "# fixture\n");
  await commitAll("init");
  await Bun.write(join(repo, "src/a.ts"), TS_SOURCE);
  await Bun.write(join(repo, "src/b.py"), PY_SOURCE);
  await commitAll("add sources");
  process.chdir(repo);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await rm(root, { recursive: true, force: true });
});

const PREFLIGHT: PreflightOptions = { base: "HEAD~1", all: false, sort: "score", fix: false };

async function judgedJob(options: Partial<PreflightOptions> = {}): Promise<WrittenJob> {
  const job = await preflight(
    { ...PREFLIGHT, jobBase: jobs, ...options },
    { io: capture().io, judge: shardJudge(scripted) },
  );
  if (!job) throw new Error("preflight found no comments");
  return job;
}

async function runApply(
  job: WrittenJob,
  options: Partial<ApplyOptions> = {},
): Promise<Capture & { result: ApplyResult }> {
  const captured = capture();
  const result = await apply(
    { job: job.jobDir, report: false, fix: false, ...options },
    captured.io,
  );
  return { ...captured, result };
}

const VerdictFile = z.object({
  verdicts: z.array(z.object({ id: z.string(), verdict: z.unknown() })),
});

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await Bun.file(path).text()));
}

async function show(ref: string, path: string): Promise<string> {
  return (await git("show", `${ref}:${path}`)).text();
}

describe("preflight", () => {
  test("shards the ranked comments and the judge answers each shard on disk", async () => {
    const captured = capture();
    const job = await preflight(
      { ...PREFLIGHT, jobBase: jobs, shardSize: 2 },
      { io: captured.io, judge: shardJudge(scripted) },
    );

    expect(job?.count).toBe(4);
    expect(job?.shardCount).toBe(2);
    expect(strip(captured.out[0] ?? "")).toMatch(
      /^4 comments \/ 2 files \/ ~2 agents \/ ~\d+ tokens/,
    );

    const [shard0, shard1] = await Promise.all(
      (job?.shards ?? []).map(async (ref) => {
        const shard = await readJson(
          ref.path,
          z.object({
            comments: z.array(
              z.object({
                id: z.string(),
                provenance: z.object({ uncommitted: z.boolean(), authors: z.array(z.string()) }),
              }),
            ),
          }),
        );
        for (const c of shard.comments) {
          expect(c.provenance).toEqual({ uncommitted: false, authors: ["Test"] });
        }
        const verdicts = await readJson(
          join(job?.verdictsDir ?? "", `verdict-${ref.id}.json`),
          VerdictFile,
        );
        return {
          ids: shard.comments.map((c) => c.id),
          verdictIds: verdicts.verdicts.map((v) => v.id),
        };
      }),
    );
    expect(shard0?.verdictIds).toEqual(shard0?.ids);
    expect(shard1?.verdictIds).toEqual(shard1?.ids);
    expect(new Set([...(shard0?.ids ?? []), ...(shard1?.ids ?? [])]).size).toBe(4);
  });

  test("hands back null with nothing in scope", async () => {
    const captured = capture();
    const job = await preflight(
      { ...PREFLIGHT, jobBase: jobs, pathGlobs: ["docs/**"] },
      { io: captured.io, judge: shardJudge(scripted) },
    );
    expect(job).toBeNull();
    expect(strip(captured.out.join("\n"))).toBe("No comments to judge.");
  });

  test("refuses --all on a dirty tree", async () => {
    await Bun.write(join(repo, "README.md"), "# edited\n");
    const message = await rejection(
      preflight(
        { ...PREFLIGHT, base: undefined, all: true, jobBase: jobs },
        { io: capture().io, judge: shardJudge(scripted) },
      ),
    );
    expect(message).toMatch(/Working tree is not clean/);
  });
});

describe("apply --report", () => {
  test("prints the findings grouped by file and writes nothing", async () => {
    const job = await judgedJob({ shardSize: 2 });
    const { out, err, result } = await runApply(job, { report: true });

    expect(result.branch).toBeNull();
    expect(err).toEqual([]);
    expect(strip(out.join("\n"))).toMatchInlineSnapshot(`
      "1 delete / 1 trim / 1 rewrite across 2 file(s)

      src/a.ts
        :1  delete  restate-the-what  high
            Paraphrases the increment below it.
        :11  rewrite  voice  medium
            Names the shared config under praise.
            old: // This is a robust, production-grade helper that carefully handles the config.
            new: // Retry config shared by every client.

      src/b.py
        :1  trim  restate-the-what  medium
            The ordering fact survives, the narration goes.
            keep: # Validate the header before the body so a bad header fails fast."
    `);
    expect((await git("branch", "--list", "comments/*")).text().trim()).toBe("");
  });

  test("still reports a merge-request job the branch mode refuses", async () => {
    const job = await judgedJob();
    await Bun.write(join(job.jobDir, "scope.json"), JSON.stringify({ mr: "12" }));

    expect(await rejection(runApply(job))).toMatch(/merge request !12 .* Re-run with --report/);
    const { out } = await runApply(job, { report: true });
    expect(strip(out.join("\n"))).toMatch(/^1 delete \/ 1 trim \/ 1 rewrite across 2 file\(s\)/);
  });
});

describe("apply", () => {
  test("lands the trim, partial trim, and rewrite on a fresh branch off HEAD", async () => {
    const job = await judgedJob({ shardSize: 1 });
    const head = (await git("rev-parse", "HEAD")).text().trim();
    const { out, err, result } = await runApply(job);

    const branch = `comments/audit-${basename(job.jobDir)}`;
    expect(result.branch).toBe(branch);
    expect(err).toEqual([]);
    expect(strip(out.join("\n"))).toBe(
      `Applied 1 delete / 1 trim / 1 rewrite across 2 file(s) on branch ${branch}. Review with git diff HEAD..${branch}.`,
    );

    expect((await git("rev-parse", `${branch}^`)).text().trim()).toBe(head);
    expect((await git("branch", "--show-current")).text().trim()).toBe("main");
    expect((await git("status", "--porcelain")).text().trim()).toBe("");
    expect(await show(branch, "src/a.ts")).toMatchInlineSnapshot(`
      "let counter = 0;
      counter += 1;

      /**
       * Retries are capped at three because the upstream limiter resets every ten
       * seconds and a fourth attempt always lands inside the same window.
       */
      export function retry(): void {}

      // Retry config shared by every client.
      export const config = { retries: 3 };
      "
    `);
    expect(await show(branch, "src/b.py")).toMatchInlineSnapshot(`
      "# Validate the header before the body so a bad header fails fast.
      def parse():
          return 1
      "
    `);
  });

  test("formats each edited file through the template", async () => {
    const job = await judgedJob();
    const { err, result } = await runApply(job, { format: "cat && printf '# formatted %s\\n' {}" });

    expect(err).toEqual([]);
    expect(await show(result.branch ?? "", "src/a.ts")).toEndWith("# formatted src/a.ts\n");
    expect(await show(result.branch ?? "", "src/b.py")).toEndWith("# formatted src/b.py\n");
  });

  test("keeps the unformatted content when the formatter fails", async () => {
    const job = await judgedJob();
    const { err, result } = await runApply(job, { format: "exit 3" });

    expect(strip(err.join("\n"))).toBe(
      [
        "Formatter failed for src/a.ts (exit 3: ); keeping unformatted content.",
        "Formatter failed for src/b.py (exit 3: ); keeping unformatted content.",
      ].join("\n"),
    );
    expect(await show(result.branch ?? "", "src/b.py")).toBe(result.edits.get("src/b.py") ?? "");
  });

  test("skips a comment that changed since preflight and reports the drift", async () => {
    const job = await judgedJob();
    await Bun.write(
      join(repo, "src/b.py"),
      PY_SOURCE.replace("Parse the header", "Read the header"),
    );
    await commitAll("edit b.py");
    const { err, result } = await runApply(job);

    expect(result.drift).toHaveLength(1);
    expect([...result.edits.keys()]).toEqual(["src/a.ts"]);
    expect(strip(err.join("\n"))).toBe(
      "Skipped 1 judged comment(s) no longer found at preflight position (file changed since preflight).",
    );
    expect((await git("diff", "--name-only", `HEAD..${result.branch ?? ""}`)).text().trim()).toBe(
      "src/a.ts",
    );
  });

  test("skips a judged file that no longer exists", async () => {
    const job = await judgedJob();
    await git("rm", "-q", "src/a.ts");
    await commitAll("drop a.ts");
    const { out, result } = await runApply(job, { report: true });

    expect(result.drift).toHaveLength(3);
    expect(strip(out.join("\n"))).toMatch(/^0 delete \/ 1 trim \/ 0 rewrite across 1 file\(s\)/);
    expect(strip(out.join("\n"))).not.toContain("src/a.ts");
  });

  test("refuses a dirty tree in branch mode", async () => {
    const job = await judgedJob();
    await Bun.write(join(repo, "README.md"), "# edited\n");
    expect(await rejection(runApply(job))).toMatch(/Working tree is not clean/);
  });

  test("names the missing job or verdicts", async () => {
    const judged = await judgedJob();
    expect(await rejection(runApply({ ...judged, jobDir: join(jobs, "nope") }))).toMatch(
      /No job at/,
    );
    const unjudged = await preflight(
      { ...PREFLIGHT, jobBase: join(root, "unjudged") },
      { io: capture().io, judge: () => Promise.resolve() },
    );
    if (!unjudged) throw new Error("preflight found no comments");
    expect(await rejection(runApply(unjudged))).toMatch(/No verdicts for shard\(s\) 0 in/);
  });

  test("refuses a job whose shards were only partly judged", async () => {
    const job = await judgedJob({ shardSize: 2 });
    await rm(join(job.verdictsDir, "verdict-1.json"));
    expect(await rejection(runApply(job, { report: true }))).toMatch(
      /No verdicts for shard\(s\) 1 in/,
    );
  });

  test("refuses a verdict file that skips one of its shard's comments", async () => {
    const job = await judgedJob();
    const path = join(job.verdictsDir, "verdict-0.json");
    const file = await readJson(path, VerdictFile);
    const dropped = file.verdicts.pop();
    await Bun.write(path, JSON.stringify(file));
    expect(await rejection(runApply(job, { report: true }))).toMatch(
      new RegExp(`omit 1 judged comment\\(s\\): ${dropped?.id}`),
    );
  });

  test("refuses a verdict filed under another shard", async () => {
    const job = await judgedJob({ shardSize: 2 });
    const firstPath = join(job.verdictsDir, "verdict-0.json");
    const secondPath = join(job.verdictsDir, "verdict-1.json");
    const first = await readJson(firstPath, VerdictFile);
    const second = await readJson(secondPath, VerdictFile);
    const moved = second.verdicts.pop();
    if (!moved) throw new Error("second shard has no verdicts");
    first.verdicts.push(moved);
    await Bun.write(firstPath, JSON.stringify(first));
    await Bun.write(secondPath, JSON.stringify(second));
    expect(await rejection(runApply(job, { report: true }))).toMatch(
      new RegExp(`omit 1 judged comment\\(s\\): ${moved.id}`),
    );
  });

  test("gives a --fix run its own job dir", async () => {
    const plain = await judgedJob();
    const fix = await judgedJob({ fix: true });
    expect(fix.jobDir).not.toBe(plain.jobDir);
  });
});

describe("audit.ts", () => {
  const script = join(import.meta.dirname, "audit.ts");

  async function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    const proc = Bun.spawn([process.execPath, script, ...args], {
      cwd: repo,
      env: { ...process.env, TMPDIR: jobs, GIT_CONFIG_GLOBAL: "/dev/null" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: strip(stdout), stderr: strip(stderr), code };
  }

  const Preflight = z.object({
    scriptPath: z.string(),
    argsPath: z.string(),
    jobDir: z.string(),
    count: z.number(),
    shardCount: z.number(),
  });

  const JobArgs = z.object({
    shards: z.array(z.object({ id: z.number(), path: z.string() })),
    verdictsDir: z.string(),
  });

  test("preflight hands the job to the workflow and apply reads the verdicts back", async () => {
    const pre = await run("preflight", "--all", "--shard-size", "2");
    expect(pre.code).toBe(0);
    const block = /<preflight>\n(.*)\n<\/preflight>/.exec(pre.stdout);
    const handoff = Preflight.parse(JSON.parse(block?.[1] ?? ""));
    expect(handoff.scriptPath).toEndWith("workflow/judge.workflow.js");
    expect(await Bun.file(handoff.scriptPath).exists()).toBe(true);
    expect(handoff.jobDir.startsWith(jobs)).toBe(true);
    expect(handoff).toMatchObject({ count: 4, shardCount: 2 });

    const args = await readJson(handoff.argsPath, JobArgs);
    await shardJudge(scripted)({ ...handoff, ...args });

    const applied = await run("apply", "--job", handoff.jobDir, "--report");
    expect(applied.code).toBe(0);
    expect(applied.stderr).toBe("");
    expect(applied.stdout).toMatch(/^1 delete \/ 1 trim \/ 1 rewrite across 2 file\(s\)\n/);
  });

  test("exits 1 with the message on a usage error", async () => {
    const result = await run("apply", "--job", join(jobs, "nope"));
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(
      `No job at ${join(jobs, "nope")}. Pass the job dir printed by preflight.`,
    );
  });
});
