import { expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  assignSplit,
  candidateBody,
  type Candidate,
  countProseWordsAdded,
  countWordsAdded,
  extractAddedProse,
  fitsDiffBudget,
  hasAiMarkers,
  hasMatchingCommand,
  hasTouchedFile,
  isBinaryPath,
  isEligibleDate,
  isPostWindow,
  isPreClaudeCode,
  markBalance,
  projectPathMatchesRepo,
  proseLength,
  renderBriefsMarkdown,
  repoShortName,
  selectSample,
  type SplitCandidate,
  type Surface,
  textAppearsInCommand,
  type ToolCallRow,
  weave,
  withinHours,
} from "./mine";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "",
    surface: "pr",
    repo: "bendrucker/claude",
    ref: "1",
    createdAt: "2026-01-01T00:00:00Z",
    url: "https://github.com/bendrucker/claude/pull/1",
    summary: "a summary",
    diff: { files: 1, changedLines: 10, binaryFiles: 0 },
    notes: "",
    body: "a body",
    ...overrides,
  };
}

function makeSplitCandidate(overrides: Partial<SplitCandidate> = {}): SplitCandidate {
  return { ...makeCandidate(overrides), split: "dev", balance: false, ...overrides };
}

function makeRow(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    project_path: "/Users/ben/src/bendrucker/claude",
    timestamp: "2026-07-01T12:00:00Z",
    command: null,
    file_path: null,
    ...overrides,
  };
}

test.each<{ name: string; createdAt: string; expected: boolean }>([
  { name: "well before the cutoff", createdAt: "2024-01-01T00:00:00Z", expected: true },
  { name: "one second before the cutoff", createdAt: "2025-02-23T23:59:59Z", expected: true },
  { name: "exactly at the cutoff", createdAt: "2025-02-24T00:00:00Z", expected: false },
  { name: "after the cutoff", createdAt: "2025-06-01T00:00:00Z", expected: false },
])("isPreClaudeCode: $name", ({ createdAt, expected }) => {
  expect(isPreClaudeCode(createdAt)).toBe(expected);
});

test.each<{ name: string; createdAt: string; expected: boolean }>([
  { name: "before the window", createdAt: "2026-06-29T23:59:59Z", expected: false },
  { name: "exactly at the window start", createdAt: "2026-06-30T00:00:00Z", expected: true },
  { name: "well after the window", createdAt: "2026-09-01T00:00:00Z", expected: true },
])("isPostWindow: $name", ({ createdAt, expected }) => {
  expect(isPostWindow(createdAt)).toBe(expected);
});

test.each<{ name: string; createdAt: string; expected: boolean }>([
  { name: "pre-Claude-Code", createdAt: "2024-01-01T00:00:00Z", expected: true },
  { name: "in the excluded middle", createdAt: "2025-08-01T00:00:00Z", expected: false },
  { name: "post-window", createdAt: "2026-07-01T00:00:00Z", expected: true },
])("isEligibleDate: $name", ({ createdAt, expected }) => {
  expect(isEligibleDate(createdAt)).toBe(expected);
});

test.each<{ name: string; text: string; expected: boolean }>([
  { name: "mentions Claude", text: "Drafted with Claude's help", expected: true },
  { name: "case-insensitive Claude", text: "used claude for this", expected: true },
  { name: "generated with marker", text: "Generated with a tool", expected: true },
  { name: "co-authored-by trailer", text: "fix: typo\n\nCo-Authored-By: someone", expected: true },
  {
    name: "clean prose",
    text: "This fixes a race condition in the queue consumer.",
    expected: false,
  },
])("hasAiMarkers: $name", ({ text, expected }) => {
  expect(hasAiMarkers(text)).toBe(expected);
});

test.each<{ name: string; body: string; expected: number }>([
  { name: "plain prose", body: "abcde", expected: 5 },
  { name: "strips HTML comment scaffolding", body: "<!-- template --> real content", expected: 12 },
  { name: "trims surrounding whitespace", body: "  padded  ", expected: 6 },
])("proseLength: $name", ({ body, expected }) => {
  expect(proseLength(body)).toBe(expected);
});

test.each<{ name: string; path: string; expected: boolean }>([
  { name: "markdown", path: "docs/README.md", expected: false },
  { name: "typescript", path: "src/index.ts", expected: false },
  { name: "png", path: "assets/logo.PNG", expected: true },
  { name: "font", path: "fonts/a.woff2", expected: true },
  { name: "no extension", path: "Makefile", expected: false },
])("isBinaryPath: $name", ({ path, expected }) => {
  expect(isBinaryPath(path)).toBe(expected);
});

test.each<{
  name: string;
  stats: { files: number; changedLines: number; binaryFiles: number };
  expected: boolean;
}>([
  { name: "within budget", stats: { files: 3, changedLines: 100, binaryFiles: 0 }, expected: true },
  {
    name: "too many files",
    stats: { files: 11, changedLines: 10, binaryFiles: 0 },
    expected: false,
  },
  {
    name: "too many lines",
    stats: { files: 1, changedLines: 401, binaryFiles: 0 },
    expected: false,
  },
  {
    name: "has a binary file",
    stats: { files: 1, changedLines: 5, binaryFiles: 1 },
    expected: false,
  },
  {
    name: "exactly at the budget",
    stats: { files: 10, changedLines: 400, binaryFiles: 0 },
    expected: true,
  },
])("fitsDiffBudget: $name", ({ stats, expected }) => {
  expect(fitsDiffBudget(stats)).toBe(expected);
});

test.each<{ name: string; patch: string; expected: number }>([
  { name: "no patch", patch: "", expected: 0 },
  {
    name: "counts only added lines",
    patch: "@@ -1,2 +1,3 @@\n-old line here\n+two words\n context line",
    expected: 2,
  },
  { name: "skips the +++ file header", patch: "+++ b/README.md\n+one two three", expected: 3 },
  { name: "skips a blank added line", patch: "+\n+real content here", expected: 3 },
])("countWordsAdded: $name", ({ patch, expected }) => {
  expect(countWordsAdded(patch)).toBe(expected);
});

test.each<{ name: string; patch: string; expected: string }>([
  {
    name: "plain prose passes through",
    patch: "+Replace your directive.",
    expected: "Replace your directive.",
  },
  {
    name: "drops a fenced code block",
    patch: "+Usage:\n+```js\n+var x = require('x')\n+```\n+That's it.",
    expected: "Usage:\nThat's it.",
  },
  {
    name: "drops a standalone badge image",
    patch:
      "+# my-module\n+[![build](https://ci.example/badge.svg)](https://ci.example)\n+A real description.",
    expected: "# my-module\nA real description.",
  },
  {
    name: "drops table rows",
    patch:
      "+| Name | Description |\n+| --- | --- |\n+| path | The module path |\n+Prose after the table.",
    expected: "Prose after the table.",
  },
  { name: "empty patch", patch: "", expected: "" },
  {
    name: "collapses blank lines left behind by a dropped code block",
    patch: "+Before.\n+\n+```js\n+var x = 1\n+```\n+\n+After.",
    expected: "Before.\n\nAfter.",
  },
])("extractAddedProse: $name", ({ patch, expected }) => {
  expect(extractAddedProse(patch)).toBe(expected);
});

test.each<{ name: string; patch: string; expected: number }>([
  { name: "no patch", patch: "", expected: 0 },
  { name: "counts prose words", patch: "+one two three", expected: 3 },
  {
    name: "excludes fenced code from the count",
    patch: "+intro words here\n+```js\n+var a = 1 + 2 + 3\n+```",
    expected: 3,
  },
  {
    name: "excludes badge and table lines from the count",
    patch:
      "+[![build](https://ci.example/badge.svg)](https://ci.example)\n" +
      "+| a | b |\n" +
      "+real prose words here",
    expected: 4,
  },
])("countProseWordsAdded: $name", ({ patch, expected }) => {
  expect(countProseWordsAdded(patch)).toBe(expected);
});

test.each<{
  name: string;
  message: string;
  targetFiles: { filename: string; patch?: string }[];
  minWords: number;
  expected: string;
}>([
  {
    name: "uses the commit message when it carries enough prose",
    message: "explain the design in detail with several sentences of rationale",
    targetFiles: [{ filename: "README.md", patch: "+short readme line" }],
    minWords: 5,
    expected: "explain the design in detail with several sentences of rationale",
  },
  {
    name: "falls back to the diff's added prose when the message is terse",
    message: "docs(README): add documentation",
    targetFiles: [
      { filename: "README.md", patch: "+## Usage\n+Call the function with an object." },
    ],
    minWords: 5,
    expected: "## Usage\nCall the function with an object.",
  },
  {
    name: "falls back to the message when neither carries enough prose",
    message: "readme",
    targetFiles: [{ filename: "README.md", patch: "+```js\n+var x = 1\n+```" }],
    minWords: 5,
    expected: "readme",
  },
])("candidateBody: $name", ({ message, targetFiles, minWords, expected }) => {
  expect(candidateBody(message, targetFiles, minWords)).toBe(expected);
});

test.each<{ name: string; repo: string; expected: string }>([
  { name: "owner/repo", repo: "bendrucker/claude", expected: "claude" },
  { name: "bare name", repo: "claude", expected: "claude" },
])("repoShortName: $name", ({ repo, expected }) => {
  expect(repoShortName(repo)).toBe(expected);
});

test.each<{ name: string; projectPath: string; repo: string; expected: boolean }>([
  {
    name: "owner-prefixed checkout",
    projectPath: "/Users/ben/src/bendrucker/claude",
    repo: "bendrucker/claude",
    expected: true,
  },
  {
    name: "bare checkout",
    projectPath: "/Users/ben/src/claude",
    repo: "bendrucker/claude",
    expected: true,
  },
  {
    name: "worktree of the repo",
    projectPath: "/Users/ben/src/bendrucker/claude/.worktrees/foo",
    repo: "bendrucker/claude",
    expected: true,
  },
  {
    name: "a different repo",
    projectPath: "/Users/ben/src/bendrucker/dotfiles",
    repo: "bendrucker/claude",
    expected: false,
  },
  {
    name: "a repo name as a substring only",
    projectPath: "/Users/ben/src/bendrucker/claude-code-agents-md",
    repo: "bendrucker/claude",
    expected: false,
  },
])("projectPathMatchesRepo: $name", ({ projectPath, repo, expected }) => {
  expect(projectPathMatchesRepo(projectPath, repo)).toBe(expected);
});

test.each<{ name: string; a: string; b: string; hours: number; expected: boolean }>([
  {
    name: "same instant",
    a: "2026-07-01T00:00:00Z",
    b: "2026-07-01T00:00:00Z",
    hours: 1,
    expected: true,
  },
  {
    name: "within the window",
    a: "2026-07-01T00:00:00Z",
    b: "2026-07-01T12:00:00Z",
    hours: 24,
    expected: true,
  },
  {
    name: "outside the window",
    a: "2026-07-01T00:00:00Z",
    b: "2026-07-03T00:00:00Z",
    hours: 24,
    expected: false,
  },
  {
    name: "order does not matter",
    a: "2026-07-03T00:00:00Z",
    b: "2026-07-01T00:00:00Z",
    hours: 24,
    expected: false,
  },
])("withinHours: $name", ({ a, b, hours, expected }) => {
  expect(withinHours(a, b, hours)).toBe(expected);
});

test.each<{ name: string; command: string; needle: string; expected: boolean }>([
  {
    name: "exact substring",
    command: 'gh issue create --title "Fix the thing" --body "..."',
    needle: "Fix the thing",
    expected: true,
  },
  {
    name: "quote style differs",
    command: "gh issue create --title 'Fix the thing' --body ...",
    needle: '"Fix the thing"',
    expected: true,
  },
  {
    name: "not present",
    command: "gh issue create --title Unrelated",
    needle: "Fix the thing",
    expected: false,
  },
  {
    name: "needle too short to trust",
    command: "git commit -m fix",
    needle: "fix",
    expected: false,
  },
])("textAppearsInCommand: $name", ({ command, needle, expected }) => {
  expect(textAppearsInCommand(command, needle)).toBe(expected);
});

test("hasMatchingCommand requires repo, time, and text to all match", () => {
  const rows: ToolCallRow[] = [
    makeRow({
      command: 'gh issue create --title "Queue consumer stopped" --body "..."',
      timestamp: "2026-08-03T10:00:00Z",
    }),
  ];
  expect(
    hasMatchingCommand(rows, "bendrucker/claude", "2026-08-03T10:05:00Z", "Queue consumer stopped"),
  ).toBe(true);
  expect(
    hasMatchingCommand(
      rows,
      "bendrucker/dotfiles",
      "2026-08-03T10:05:00Z",
      "Queue consumer stopped",
    ),
  ).toBe(false);
  expect(
    hasMatchingCommand(rows, "bendrucker/claude", "2026-08-05T10:05:00Z", "Queue consumer stopped"),
  ).toBe(false);
  expect(
    hasMatchingCommand(rows, "bendrucker/claude", "2026-08-03T10:05:00Z", "A different title"),
  ).toBe(false);
});

test("hasTouchedFile requires repo, time, and a matching file path suffix", () => {
  const rows: ToolCallRow[] = [
    makeRow({
      file_path: "/Users/ben/src/bendrucker/claude/plugins/writing/skills/rewrite/SKILL.md",
      timestamp: "2026-07-10T00:00:00Z",
    }),
  ];
  expect(
    hasTouchedFile(
      rows,
      "bendrucker/claude",
      "2026-07-10T01:00:00Z",
      "plugins/writing/skills/rewrite/SKILL.md",
    ),
  ).toBe(true);
  expect(
    hasTouchedFile(
      rows,
      "bendrucker/claude",
      "2026-07-10T01:00:00Z",
      "plugins/writing/skills/scan/SKILL.md",
    ),
  ).toBe(false);
  expect(hasTouchedFile(rows, "bendrucker/dotfiles", "2026-07-10T01:00:00Z", "SKILL.md")).toBe(
    false,
  );
});

test("weave interleaves longest and shortest", () => {
  const lengths = [1, 2, 3, 4, 5];
  expect(weave(lengths, (n) => n)).toEqual([5, 1, 4, 2, 3]);
});

test("weave preserves the multiset", () => {
  hegel.test((tc) => {
    const lengths = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 100 })));
    const woven = weave(lengths, (n) => n);
    expect(woven.toSorted((a, b) => a - b)).toEqual(lengths.toSorted((a, b) => a - b));
  });
});

test.each<{
  name: string;
  counts: Record<string, number>;
  limit: number;
  maxPerRepo: number;
  expected: string[];
}>([
  {
    name: "round-robins across repos before repeating one",
    counts: { "bendrucker/claude": 3, "bendrucker/dotfiles": 1 },
    limit: 3,
    maxPerRepo: 3,
    expected: ["bendrucker/claude", "bendrucker/dotfiles", "bendrucker/claude"],
  },
  {
    name: "caps how many come from one repo",
    counts: { "bendrucker/claude": 5, "bendrucker/dotfiles": 5 },
    limit: 10,
    maxPerRepo: 2,
    expected: [
      "bendrucker/claude",
      "bendrucker/dotfiles",
      "bendrucker/claude",
      "bendrucker/dotfiles",
    ],
  },
  {
    name: "returns everything when under the limit and cap",
    counts: { "bendrucker/claude": 2 },
    limit: 50,
    maxPerRepo: 5,
    expected: ["bendrucker/claude", "bendrucker/claude"],
  },
])("selectSample $name", ({ counts, limit, maxPerRepo, expected }) => {
  const candidates = Object.entries(counts).flatMap(([repo, n]) =>
    Array.from({ length: n }, (_, i) =>
      makeCandidate({ repo, ref: String(i + 1), body: "x".repeat(10 * (i + 1)) }),
    ),
  );
  const selected = selectSample(candidates, limit, maxPerRepo);
  expect(selected.map((s) => s.repo)).toEqual(expected);
});

test.each<{ name: string; length: number; expectedHoldout: number }>([
  { name: "empty", length: 0, expectedHoldout: 0 },
  { name: "under a full group of three", length: 2, expectedHoldout: 0 },
  { name: "exactly one group of three", length: 3, expectedHoldout: 1 },
  { name: "two full groups", length: 6, expectedHoldout: 2 },
  { name: "sixteen items (the suite's dev PR count)", length: 16, expectedHoldout: 5 },
])("assignSplit: $name", ({ length, expectedHoldout }) => {
  const items = Array.from({ length }, (_, i) => makeCandidate({ ref: String(i) }));
  const split = assignSplit(items);
  expect(split.filter((s) => s.split === "holdout")).toHaveLength(expectedHoldout);
  expect(split.filter((s) => s.split === "dev")).toHaveLength(length - expectedHoldout);
});

test("markBalance marks the smallest-weight dev items and leaves holdout untouched", () => {
  const items = assignSplit([
    makeCandidate({ ref: "big-dev", diff: { files: 1, changedLines: 300, binaryFiles: 0 } }),
    makeCandidate({ ref: "small-dev", diff: { files: 1, changedLines: 5, binaryFiles: 0 } }),
    makeCandidate({ ref: "holdout-small", diff: { files: 1, changedLines: 1, binaryFiles: 0 } }),
  ]);
  const balanced = markBalance(items, 1, (item) => item.diff.changedLines);
  expect(balanced.find((i) => i.ref === "small-dev")?.balance).toBe(true);
  expect(balanced.find((i) => i.ref === "big-dev")?.balance).toBe(false);
  expect(balanced.find((i) => i.ref === "holdout-small")?.split).toBe("holdout");
  expect(balanced.find((i) => i.ref === "holdout-small")?.balance).toBe(false);
});

test("renderBriefsMarkdown formats a table per surface plus a Gaps section", () => {
  const pr = makeSplitCandidate({ id: "pr-001", repo: "bendrucker/claude", ref: "42" });
  const holdoutPr = makeSplitCandidate({
    id: "pr-002",
    repo: "bendrucker/claude",
    ref: "43",
    summary: "has a | pipe",
    split: "holdout",
  });
  const balancePr = makeSplitCandidate({
    id: "pr-003",
    repo: "bendrucker/dotfiles",
    ref: "9",
    balance: true,
  });
  const bySurface = new Map<Surface, SplitCandidate[]>([
    ["pr", [pr, holdoutPr, balancePr]],
    ["issue", []],
  ]);
  expect(renderBriefsMarkdown(bySurface, ["a known gap"])).toMatchInlineSnapshot(`
    "## PR bodies

    | id | repo | number/sha | date | summary | diff size | split | notes |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    | pr-001 | bendrucker/claude | 42 | 2026-01-01 | a summary | 1f/10l | dev |  |
    | pr-002 | bendrucker/claude | 43 | 2026-01-01 | has a \\| pipe | 1f/10l | holdout |  |
    | pr-003 | bendrucker/dotfiles | 9 | 2026-01-01 | a summary | 1f/10l | dev (balance) |  |

    ## Gaps

    - a known gap
    "
  `);
});

test("renderBriefsMarkdown omits an empty surface and defaults Gaps to None", () => {
  const bySurface = new Map<Surface, SplitCandidate[]>([["issue", []]]);
  expect(renderBriefsMarkdown(bySurface, [])).toBe("## Gaps\n\n- None.\n");
});
