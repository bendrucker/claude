import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  applyProposals,
  classTable,
  edit,
  EVENTS_DIR_VAR,
  eventRecord,
  eventsRoot,
  program,
  revertEdits,
  units,
  type Proposal,
} from "./audit";

const SCRATCH_PARENT = tmpdir();

function proposal(id: string, quote: string, replacement = "", file = "doc.md"): Proposal {
  return { id, file, quote, replacement, class: "no-op", reason: "test" };
}

async function run(root: string, ...argv: string[]): Promise<void> {
  const original = process.cwd();
  process.chdir(root);
  try {
    await program.parseAsync(argv, { from: "user" });
  } finally {
    process.chdir(original);
  }
}

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}`);
  return out.trim();
}

async function scratchRepo(base: string): Promise<string> {
  const root = join(base, "repo");
  mkdirSync(root, { recursive: true });
  await sh(root, "git", "init", "-q", "-b", "main");
  await sh(root, "git", "config", "user.email", "test@example.com");
  await sh(root, "git", "config", "user.name", "Test");
  await sh(root, "git", "config", "commit.gpgsign", "false");
  await sh(root, "git", "remote", "add", "origin", "https://github.com/bendrucker/claude.git");
  return root;
}

describe("edit", () => {
  test.each<{ name: string; text: string; quote: string; expected: string }>([
    {
      name: "paragraph between paragraphs",
      text: "a\n\nQuote.\n\nb\n",
      quote: "Quote.",
      expected: "a\n\nb\n",
    },
    { name: "line between lines", text: "a\nQuote.\nb\n", quote: "Quote.", expected: "a\nb\n" },
    { name: "list item", text: "- a\n- Quote\n- b\n", quote: "- Quote", expected: "- a\n- b\n" },
    {
      name: "indented line",
      text: "- a\n  Quote.\n- b\n",
      quote: "Quote.",
      expected: "- a\n- b\n",
    },
    { name: "first paragraph", text: "Quote.\n\nb\n", quote: "Quote.", expected: "b\n" },
    { name: "last paragraph", text: "a\n\nQuote.\n", quote: "Quote.", expected: "a\n" },
    { name: "last line without a newline", text: "a\nQuote.", quote: "Quote.", expected: "a" },
    {
      name: "paragraph before a blank line",
      text: "a\nQuote.\n\nb\n",
      quote: "Quote.",
      expected: "a\n\nb\n",
    },
    {
      name: "paragraph after a blank line",
      text: "a\n\nQuote.\nb\n",
      quote: "Quote.",
      expected: "a\n\nb\n",
    },
    {
      name: "middle of a line",
      text: "One. Quote. Two.\n",
      quote: "Quote.",
      expected: "One. Two.\n",
    },
    { name: "end of a line", text: "One. Quote.\nTwo\n", quote: "Quote.", expected: "One.\nTwo\n" },
    { name: "start of a line", text: "Quote. Two.\n", quote: "Quote.", expected: "Two.\n" },
    {
      name: "multi-line quote",
      text: "a\n\nFirst line\nsecond line.\n\nb\n",
      quote: "First line\nsecond line.",
      expected: "a\n\nb\n",
    },
    {
      name: "quote spanning part of two lines",
      text: "Keep this. Cut one\ncut two. Keep that.\n",
      quote: "Cut one\ncut two.",
      expected: "Keep this. Keep that.\n",
    },
  ])("deletes $name cleanly", ({ text, quote, expected }) => {
    const result = edit(text, quote, "");
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.text).toBe(expected);
    expect(text.slice(0, result.start) + result.removed + result.text.slice(result.start)).toBe(
      text,
    );
  });

  test("replaces in place without trimming", () => {
    const result = edit("One. Long sentence here. Two.\n", "Long sentence here.", "Short.");
    expect(result).toMatchObject({
      text: "One. Short. Two.\n",
      removed: "Long sentence here.",
      inserted: "Short.",
    });
  });

  test("replaces a multi-line quote with one line", () => {
    const result = edit("a\n\nOne\ntwo.\n\nb\n", "One\ntwo.", "Merged.");
    expect(result).toMatchObject({ text: "a\n\nMerged.\n\nb\n" });
  });

  test.each([
    { name: "missing", text: "a\nb\n", quote: "c", expected: "missing" },
    { name: "empty", text: "a\nb\n", quote: "", expected: "missing" },
    { name: "ambiguous", text: "same\nsame\n", quote: "same", expected: "ambiguous" },
  ])("reports a $name quote", ({ text, quote, expected }) => {
    expect(edit(text, quote, "")).toBe(expected);
  });
});

describe("round", () => {
  let base = "";

  beforeAll(() => {
    base = mkdtempSync(join(SCRATCH_PARENT, "audit-round-"));
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${base}`.quiet();
  });

  const original = [
    "---",
    "name: demo",
    "---",
    "",
    "# Demo",
    "",
    "Always run the tests. Do not skip them.",
    "",
    "Remember to be careful.",
    "",
    "Be very, very careful.",
    "Check twice.",
    "",
    "- first item",
    "- second item",
    "",
    "Final paragraph that stays. Trailing sentence that goes.",
    "",
  ].join("\n");

  const other = "Alpha.\n\nBeta.\n\nGamma.\n";

  const proposals = [
    proposal("p1", "Remember to be careful.", ""),
    proposal("p2", "Be very, very careful.\nCheck twice.", "Be careful."),
    proposal("p3", "- second item", ""),
    proposal("p4", " Trailing sentence that goes.", ""),
    proposal("p5", "Beta.", "", "other.md"),
    proposal("p6", "Gamma.", "", "other.md"),
  ];

  async function seed(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "doc.md"), original);
    await Bun.write(join(dir, "other.md"), other);
  }

  test("apply then revert of everything restores every byte", async () => {
    const dir = join(base, "all");
    await seed(dir);
    const { applied, unlocated } = await applyProposals(dir, proposals);
    expect(unlocated).toEqual([]);
    expect(applied.map((row) => row.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(await Bun.file(join(dir, "doc.md")).text()).not.toBe(original);

    const result = await revertEdits(dir, applied, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(result.failed).toEqual([]);
    expect(await Bun.file(join(dir, "doc.md")).text()).toBe(original);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe(other);
  });

  test("reverting one of several edits keeps the others", async () => {
    const dir = join(base, "subset");
    await seed(dir);
    const { applied } = await applyProposals(dir, proposals);
    const result = await revertEdits(dir, applied, ["p2", "p5"]);
    expect(result.failed).toEqual([]);

    const expected = await (async () => {
      const fresh = join(base, "subset-expected");
      await seed(fresh);
      await applyProposals(
        fresh,
        proposals.filter((entry) => !["p2", "p5"].includes(entry.id)),
      );
      return Promise.all([
        Bun.file(join(fresh, "doc.md")).text(),
        Bun.file(join(fresh, "other.md")).text(),
      ]);
    })();
    expect(await Bun.file(join(dir, "doc.md")).text()).toBe(expected[0]);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe(expected[1]);
  });

  test("reverting one of two adjacent deletions leaves the other deleted", async () => {
    const dir = join(base, "adjacent");
    await seed(dir);
    const { applied } = await applyProposals(dir, [
      proposal("a", "Beta.", "", "other.md"),
      proposal("b", "Gamma.", "", "other.md"),
    ]);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe("Alpha.\n");
    await revertEdits(dir, applied, ["a"]);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe("Alpha.\n\nBeta.\n");
  });

  test("reverting two adjacent deletions in one call restores their order", async () => {
    const dir = join(base, "adjacent-both");
    await seed(dir);
    const { applied } = await applyProposals(dir, [
      proposal("a", "Beta.", "", "other.md"),
      proposal("b", "Gamma.", "", "other.md"),
    ]);
    await revertEdits(dir, applied, ["a", "b"]);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe(other);
  });

  test("a deletion leaves no doubled blank line", async () => {
    const dir = join(base, "clean");
    await seed(dir);
    await applyProposals(dir, proposals);
    const text = await Bun.file(join(dir, "doc.md")).text();
    expect(text).not.toContain("\n\n\n");
    expect(text).toContain(
      "# Demo\n\nAlways run the tests. Do not skip them.\n\nBe careful.\n\n- first item\n\nFinal paragraph that stays.\n",
    );
  });

  test("missing and ambiguous quotes are reported and skipped", async () => {
    const dir = join(base, "unlocated");
    await seed(dir);
    await Bun.write(join(dir, "dupe.md"), "Same.\n\nSame.\n");
    const { applied, unlocated } = await applyProposals(dir, [
      proposal("m", "Not in the file."),
      proposal("d", "Same.", "", "dupe.md"),
      proposal("f", "Alpha.", "", "gone.md"),
      proposal("ok", "Alpha.", "", "other.md"),
    ]);
    expect(applied.map((row) => row.id)).toEqual(["ok"]);
    expect(unlocated).toEqual([
      { id: "m", file: "doc.md", why: "missing" },
      { id: "d", file: "dupe.md", why: "ambiguous" },
      { id: "f", file: "gone.md", why: "no such file" },
    ]);
    expect(await Bun.file(join(dir, "doc.md")).text()).toBe(original);
    expect(await Bun.file(join(dir, "dupe.md")).text()).toBe("Same.\n\nSame.\n");
  });

  test("reverting an unknown or already-undone edit fails without touching the file", async () => {
    const dir = join(base, "failed");
    await seed(dir);
    const { applied } = await applyProposals(dir, [proposal("x", "Beta.", "", "other.md")]);
    const unknown = await revertEdits(dir, applied, ["nope"]);
    expect(unknown.failed).toEqual([{ id: "nope", why: "not an applied proposal" }]);
    expect(await Bun.file(join(dir, "other.md")).text()).toBe("Alpha.\n\nGamma.\n");
  });
});

describe("audit commands", () => {
  let base = "";
  let events = "";
  const savedEvents = process.env[EVENTS_DIR_VAR];
  const savedSession = process.env.CLAUDE_CODE_SESSION_ID;

  beforeAll(() => {
    base = mkdtempSync(join(SCRATCH_PARENT, "audit-cli-"));
    events = join(base, "events");
    process.env[EVENTS_DIR_VAR] = events;
    delete process.env.CLAUDE_CODE_SESSION_ID;
  });

  afterAll(async () => {
    if (savedEvents === undefined) delete process.env[EVENTS_DIR_VAR];
    else process.env[EVENTS_DIR_VAR] = savedEvents;
    if (savedSession !== undefined) process.env.CLAUDE_CODE_SESSION_ID = savedSession;
    await Bun.$`rm -rf ${base}`.quiet();
  });

  async function readEvents(name: string): Promise<Record<string, unknown>[]> {
    const dir = join(events, "cli");
    const files = (
      await Array.fromAsync(new Bun.Glob("prompting-audit.*.jsonl").scan({ cwd: dir }))
    ).toSorted();
    const lines = (await Promise.all(files.map((file) => Bun.file(join(dir, file)).text())))
      .join("")
      .split("\n")
      .filter((line) => line !== "");
    return lines
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
      .filter((record) => record.event_name === name);
  }

  test("a round from apply to verdict", async () => {
    const root = await scratchRepo(base);
    const doc = [
      "# Doc",
      "",
      "Keep this sentence.",
      "",
      "Accepted cut paragraph.",
      "",
      "Rejected cut paragraph.",
      "",
      "Hand edited sentence one. Keep tail.",
      "",
    ].join("\n");
    await Bun.write(join(root, "doc.md"), doc);
    await sh(root, "git", "add", "doc.md");
    await sh(root, "git", "commit", "-q", "-m", "seed");

    const runDir = join(base, "runs", "run-7");
    mkdirSync(runDir, { recursive: true });
    const ledger = join(runDir, "proposals.jsonl");
    const rows: Proposal[] = [
      { ...proposal("accepted", "Accepted cut paragraph."), class: "no-op" },
      { ...proposal("rejected", "Rejected cut paragraph."), class: "emphasis" },
      { ...proposal("edited", "Hand edited sentence one.", "Shorter."), class: "emphasis" },
      { ...proposal("lost", "Never written."), class: "cache" },
    ];
    await Bun.write(ledger, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));

    await run(root, "apply", ledger);
    const applied = (await Bun.file(join(runDir, "applied.jsonl")).text()).trim().split("\n");
    expect(applied).toHaveLength(3);
    expect(await Bun.file(join(root, "doc.md")).text()).toBe(
      "# Doc\n\nKeep this sentence.\n\nShorter. Keep tail.\n",
    );
    expect(await readEvents("prompting-audit.proposal")).toHaveLength(3);

    await run(root, "revert", ledger, "rejected", "--reason", "This guard still earns its keep.");
    expect(await Bun.file(join(root, "doc.md")).text()).toBe(
      "# Doc\n\nKeep this sentence.\n\nRejected cut paragraph.\n\nShorter. Keep tail.\n",
    );

    // The reviewer rewrote the span the judge replaced.
    const text = await Bun.file(join(root, "doc.md")).text();
    await Bun.write(join(root, "doc.md"), text.replace("Shorter.", "Reviewer's own words."));
    await sh(root, "git", "commit", "-q", "-am", "prune");
    const sha = await sh(root, "git", "rev-parse", "HEAD");

    await run(root, "verdict", ledger, "--commit", sha);

    const proposed = await readEvents("prompting-audit.proposal");
    expect(proposed.map((record) => record.attributes)).toEqual([
      { run: "run-7", id: "accepted", class: "no-op", file: "doc.md", repo: "claude" },
      { run: "run-7", id: "rejected", class: "emphasis", file: "doc.md", repo: "claude" },
      { run: "run-7", id: "edited", class: "emphasis", file: "doc.md", repo: "claude" },
    ]);

    const verdicts = await readEvents("prompting-audit.verdict");
    expect(verdicts.map((record) => record.attributes)).toEqual([
      { run: "run-7", id: "accepted", class: "no-op", accepted: true, commit: sha, reason: "" },
      {
        run: "run-7",
        id: "rejected",
        class: "emphasis",
        accepted: false,
        commit: sha,
        reason: "This guard still earns its keep.",
      },
      { run: "run-7", id: "edited", class: "emphasis", accepted: true, commit: sha, reason: "" },
    ]);
    expect(verdicts[0]).toMatchObject({
      scope: { name: "prompting-audit" },
      severity_text: "INFO",
    });
  });

  test("apply refuses a ledger it already applied", async () => {
    const root = join(base, "repo");
    const ledger = join(base, "runs", "run-7", "proposals.jsonl");
    const failure = await run(root, "apply", ledger).catch((error: unknown) => error);
    expect(String(failure)).toContain("already applied");
  });

  test("units groups skill directories and lists other files alone", async () => {
    const root = join(base, "units");
    mkdirSync(root, { recursive: true });
    await sh(root, "git", "init", "-q");
    const files = [
      "skills/a/SKILL.md",
      "skills/a/references/x.md",
      "skills/a/notes.md",
      "skills/b/SKILL.md",
      "CLAUDE.md",
      "README.md",
      ".claude/rules/r.md",
      "pkg/fixtures/CLAUDE.md",
      "pkg/prompts/system.txt",
    ];
    await Promise.all(files.map((file) => Bun.write(join(root, file), "x\n")));
    expect(await units(["."], root)).toEqual([
      { unit: ".claude/rules/r.md", files: [".claude/rules/r.md"] },
      { unit: "CLAUDE.md", files: ["CLAUDE.md"] },
      { unit: "pkg/prompts/system.txt", files: ["pkg/prompts/system.txt"] },
      { unit: "skills/a", files: ["skills/a/SKILL.md", "skills/a/references/x.md"] },
      { unit: "skills/b", files: ["skills/b/SKILL.md"] },
    ]);
    expect(await units(["skills/b"], root)).toEqual([
      { unit: "skills/b", files: ["skills/b/SKILL.md"] },
    ]);
  });
});

describe("telemetry", () => {
  test("the events directory follows the override, then the config directory", () => {
    expect(eventsRoot({ [EVENTS_DIR_VAR]: "/x/events", CLAUDE_CONFIG_DIR: "/y" })).toBe(
      "/x/events",
    );
    expect(eventsRoot({ CLAUDE_CONFIG_DIR: "/y" })).toBe("/y/mod-events");
  });

  test("a record carries the mod-events shape", () => {
    const record = eventRecord(
      { event: "verdict", detail: { id: "p1" } },
      new Date("2026-10-29T12:00:00Z"),
      "sess-1",
    );
    expect(record).toEqual({
      timestamp: "2026-10-29T12:00:00.000Z",
      severity_text: "INFO",
      severity_number: 9,
      event_name: "prompting-audit.verdict",
      attributes: { id: "p1", "session.id": "sess-1" },
      resource: { "service.name": "claude-code" },
      scope: { name: "prompting-audit" },
    });
  });

  test("the class table totals acceptance", () => {
    const out = classTable([
      { id: "a", class: "no-op", file: "f", accepted: true, reason: "" },
      { id: "b", class: "no-op", file: "f", accepted: false, reason: "" },
      { id: "c", class: "cache", file: "f", accepted: true, reason: "" },
    ]);
    expect(out).toContain("no-op");
    expect(out).toMatch(/no-op\s+│\s+2\s+│\s+1\s+│\s+50%/);
    expect(out).toMatch(/total\s+│\s+3\s+│\s+2\s+│\s+67%/);
  });
});
