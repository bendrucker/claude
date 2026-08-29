import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import {
  type BodyContext,
  type BodyPart,
  type BodySpec,
  extractBacktickedHexCandidates,
  extractBodySpec,
  extractTitle,
  findBacktickedCommits,
  findNarrationTells,
  hasBacktickedRef,
  hasCiStatusRollCall,
  hasFileTourBullets,
  hardWrappedParagraphs,
  hasReflexiveScaffold,
  hasRunOnProse,
  type HookInput,
  isPersonalRepo,
  isPrBodyCommand,
  type NarrationTell,
  parseGhLogin,
  parseRemote,
  processInput,
  resolveBody,
  sentenceShapedHeadings,
  unwrapBody,
  validateBody,
  WRAP_MAX_LINE,
  WRAP_MIN_LINE,
} from "./validate-body";

function getPermissionDecision(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecision" in output) {
    return output.permissionDecision;
  }
  return undefined;
}

function getAdditionalContext(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "additionalContext" in output) {
    return output.additionalContext;
  }
  return undefined;
}

function getDenyReason(result: Awaited<ReturnType<typeof validateBody>>) {
  const output = result?.hookSpecificOutput;
  if (output && "permissionDecisionReason" in output) {
    return output.permissionDecisionReason;
  }
  return undefined;
}

// Four short sentences, 29 words. Bulk for a test that needs a large body,
// without tripping the run-on detector on its own.
const PROSE_PARAGRAPH =
  "The cache stores frequently accessed records in memory. It evicts the oldest entry when full. A configurable TTL bounds staleness. Reads fall back to the database on a miss.";

// Clears SMALL_BODY_WORD_LIMIT.
const LONG_PROSE = Array(6).fill(PROSE_PARAGRAPH).join("\n\n");

// Clears PERSONAL_BODY_WORD_LIMIT.
const OVERLONG_PROSE = Array(16).fill(PROSE_PARAGRAPH).join("\n\n");

describe("isPrBodyCommand", () => {
  test.each<[string, boolean]>([
    ["gh pr create --body-file body.md", true],
    ["cd /repo && gh pr create --body-file body.md", true],
    ["GH_PAGER=cat gh pr create --body-file body.md", true],
    ["GIT_SSH_COMMAND=false gh pr create --title x", true],
    ["gh pr edit 12 --body-file body.md", true],
    ["glab mr create --description-file body.md", true],
    ["glab mr update 3 --description x", true],
    ["git status", false],
    ["gh pr list", false],
    ["gh pr view 12", false],
    ["ls -la", false],
    ["{ echo one; echo two; }", false],
    ["for f in *.ts; do wc -l $f; done", false],
    ["cat <<'EOF' > notes.md\nnothing here\nEOF", false],
  ])("isPrBodyCommand(%p) -> %p", (command, expected) => {
    expect(isPrBodyCommand(command)).toBe(expected);
  });
});

const literal = (text: string): BodyPart => ({ kind: "literal", text });
const file = (filePath: string): BodyPart => ({ kind: "file", path: filePath });
const parts = (...items: BodyPart[]): BodySpec => ({ kind: "parts", parts: items });

describe("extractBodySpec", () => {
  test.each<[string, BodySpec]>([
    [
      'gh pr create --body "## Known Follow-Up\n\nprose"',
      parts(literal("## Known Follow-Up\n\nprose")),
    ],
    ["gh pr create --body '## Open Item'", parts(literal("## Open Item"))],
    ["gh pr create -b '## Open Item'", parts(literal("## Open Item"))],
    ['gh pr create --body="## Open Item"', parts(literal("## Open Item"))],
    ['gh pr create --body "a \\"quoted\\" word"', parts(literal('a "quoted" word'))],
    ["gh pr create --body-file body.md", parts(file("body.md"))],
    ['gh pr create --body "Use \\`code\\` here"', parts(literal("Use `code` here"))],
    ["gh pr create --title 'x'", { kind: "none" }],
    ["glab mr create --fill", { kind: "none" }],
    ["glab mr create --description-file body.md", parts(file("body.md"))],
    ['glab mr create --description "$(cat body.md)"', parts(file("body.md"))],
    ["glab mr update 3 --description \"$(cat 'my body.md')\"", parts(file("my body.md"))],
    ['glab mr update 3 -d "$(< body.md)"', parts(file("body.md"))],
    ['glab mr create --description "`cat body.md`"', parts(file("body.md"))],
    [
      'glab mr create --description "Intro line.\n\n$(cat body.md)"',
      parts(literal("Intro line.\n\n"), file("body.md")),
    ],
    // `-b` is the body on gh and the target branch on glab; `-d` is the
    // description on glab and the draft switch on gh.
    ["glab mr create -b main --description-file body.md", parts(file("body.md"))],
    ["gh pr create -d --body-file body.md", parts(file("body.md"))],
  ])("extractBodySpec(%p) -> %p", (command, expected) => {
    expect(extractBodySpec(command)).toEqual(expected);
  });

  test.each<[string, string]>([
    ['glab mr create --description "$(git log --oneline)"', "$(git log --oneline)"],
    ['glab mr create --description "$BODY"', "$BODY"],
    ['gh pr create --body-file "$BODY"', "$BODY"],
    ['glab mr create --description "$(cat $BODY_FILE)"', "$BODY_FILE"],
    ["glab mr create --description-file -", "standard input"],
    ["gh pr create --body-file -", "standard input"],
    ["glab mr create --description -", "editor"],
  ])("extractBodySpec(%p) reports it cannot read %p", (command, fragment) => {
    const spec = extractBodySpec(command);
    expect(spec.kind).toBe("unreadable");
    expect(spec.kind === "unreadable" ? spec.detail : "").toContain(fragment);
  });
});

const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..");

const SKILL_DOCS = [
  "plugins/pull-request/skills/create/SKILL.md",
  "plugins/pull-request/skills/update/SKILL.md",
  "plugins/gitlab/skills/merge-request/SKILL.md",
];

// A body flag carrying a value. Written out independently of the extractor's
// own flag table, so a doc that starts naming a fifth flag fails the contract
// below instead of quietly resolving to nothing.
const DOCUMENTED_BODY_ARG =
  /(?:--body-file|--description-file|--body|--description|(?<![\w-])-[bd])[=\s]\S/;

function codeSnippets(markdown: string): string[] {
  const snippets: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      snippets.push(line.trim());
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) snippets.push(match[1] ?? "");
  }
  return snippets;
}

const DOCUMENTED_FORMS: Array<[string, string]> = (
  await Promise.all(
    SKILL_DOCS.map(async (doc) => {
      const markdown = await Bun.file(path.join(REPO_ROOT, doc)).text();
      return codeSnippets(markdown)
        .filter((snippet) => DOCUMENTED_BODY_ARG.test(snippet))
        .map((snippet): [string, string] => [doc, snippet]);
    }),
  )
).flat();

// The skills are the only place a command form is written down, so a form that
// lands there without the extractor learning it is invisible until an unchecked
// body ships. These docs are read back and every body-carrying command in them
// has to resolve to the body it names.
describe("command forms the skills document", () => {
  it("finds the documented forms", () => {
    expect(DOCUMENTED_FORMS.length).toBeGreaterThanOrEqual(6);
  });

  test.each(DOCUMENTED_FORMS)("%s: %s reaches the body", async (_doc, snippet) => {
    const bodyPath = path.join(mkdtempSync(path.join(os.tmpdir(), "doc-form-")), "body.md");
    const body = "## Summary\n\nResolved through the form the skill documents.\n";
    await Bun.write(bodyPath, body);
    // Doc paths are placeholders (`tmp/pr-body-<branch>.md`, `file.md`).
    const command = snippet.replace(/\S*\.md/g, bodyPath);
    expect(await resolveBody(command, REPO_ROOT)).toEqual({ kind: "text", text: body });
  });
});

describe("validateBody", () => {
  it("returns null for valid body without test counts", () => {
    expect(
      validateBody("## Summary\nFixes a bug\n\n## Test Plan\nUnit tests cover the fix"),
    ).toBeNull();
  });

  test.each<[string, string, string]>([
    ["'Added N tests' pattern", "## Testing\nAdded 5 tests for the new feature", "test counts"],
    ["'Added N unit tests' pattern", "## Testing\nAdded 3 unit tests", "test counts"],
    ["'Added N integration tests' pattern", "## Testing\nAdded 2 integration tests", "test counts"],
    ["'N tests' pattern", "## Testing\n5 tests verify the behavior", "test counts"],
    ["lowercase 'added' pattern", "## Testing\nadded 10 tests", "test counts"],
    ["assertion count", "## Testing\nThe suite runs 1165 assertions.", "test counts"],
    ["pass/fail count", "## Testing\n`bun test`: 193 pass, 0 fail.", "test counts"],
    [
      "a sentence-case section heading",
      "## Two fixes found while testing\n\nReshapes the resolver.",
      '"Two fixes found while testing" → "Two Fixes Found While Testing"',
    ],
    [
      "a heading whose inline code must survive the suggestion",
      "## changes to `validate.ts`\n\nReshapes the resolver.",
      '"changes to `validate.ts`" → "Changes to `validate.ts`"',
    ],
    ["a backticked issue ref", "Closes `#123`.", "auto-link"],
    ["a backticked MR ref", "Supersedes `!45`.", "auto-link"],
  ])("denies body with %s", (_name, body, fragment) => {
    const result = validateBody(body);
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain(fragment);
  });

  it("lists every deny reason as a bullet in one decision", () => {
    const result = validateBody("## Two fixes found while testing\n\nAdded 5 tests. Closes `#12`.");
    expect(getPermissionDecision(result)).toBe("deny");
    const reason = getDenyReason(result);
    expect(reason).toContain("- Testing section should not mention test counts");
    expect(reason).toContain("- Section headings should use AP title case");
    expect(reason).toContain("- Commit SHAs and issue/MR refs");
  });

  it("keeps the AP-case escape note in the deny reason", () => {
    const reason = getDenyReason(validateBody("## Two fixes found while testing\n\nReshapes it."));
    expect(reason).toContain("proper noun, code identifier");
  });

  it("folds structural warnings into the deny reason", () => {
    const result = validateBody(
      "## Changes to the cache\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nManual.",
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getAdditionalContext(result)).toBeUndefined();
    const reason = getDenyReason(result);
    expect(reason).toContain("Also worth addressing in the same edit:");
    expect(reason).toContain("file by file");
  });

  it("warns on a CI-status roll-call", () => {
    const result = validateBody(
      "Adds an LRU cache to the resolver.\n\nLint passes and the build is green.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("status checks");
  });

  it("warns (does not deny) on a reflexive scaffold in a small body", () => {
    const result = validateBody(
      "## Changes\n\n- Adds a flag\n\n## Testing\n\nRan the suite.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("scaffold");
  });

  it("warns on file-tour bullets", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds an LRU cache\n- **src/index.ts**: wires it up",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("file tour");
  });

  it("warns on a run-on prose paragraph", () => {
    const result = validateBody(
      "Reshapes the resolver. It reads the cache first. It falls back to the database. It then tries the network. It retries once before giving up.\n\nFixes #1",
    );
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("runs long");
  });

  it("combines both structural warnings into one message", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nManual.",
    );
    expect(getPermissionDecision(result)).toBeUndefined();
    const context = getAdditionalContext(result);
    expect(context).toContain("scaffold");
    expect(context).toContain("file tour");
  });

  it("lets a test-count deny take precedence over structural warnings", () => {
    const result = validateBody(
      "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nAdded 5 tests",
    );
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("does not warn on a large PR with earned sections", () => {
    const body = `${LONG_PROSE}\n\n## Changes\n\n- Adds the LRU cache\n\n## Testing\n\nManual exercise of expiry and eviction.`;
    expect(validateBody(body)).toBeNull();
  });

  it("does not warn on concept-labeled bold bullets", () => {
    const result = validateBody(
      "## Changes\n\n- **Caching**: stores records in memory\n- **Eviction**: drops the oldest entry",
    );
    expect(result).toBeNull();
  });

  it("does not warn on AP-cased headings with an acronym", () => {
    expect(
      validateBody(
        "## API Changes\n\nAdds an endpoint.\n\n## Changes to the Parser\n\nRewrites it.",
      ),
    ).toBeNull();
  });

  it("names the narration tells it found", () => {
    const context = getAdditionalContext(
      validateBody("The retry count is deliberately low. Left alone: the socket timeout."),
    );
    expect(context).toContain('"deliberately"');
    expect(context).toContain('"left alone"');
  });

  it("warns on a heading that reads as a sentence", () => {
    const result = validateBody("## Why the Cache Is Cold\n\nAdds an LRU cache to the resolver.");
    expect(getPermissionDecision(result)).toBeUndefined();
    expect(getAdditionalContext(result)).toContain("read as sentences");
  });

  test.each<[string, BodyContext, boolean]>([
    ["a long body on a personal repo", { title: null, personalRepo: true }, true],
    ["a long body on a shared repo", { title: null, personalRepo: false }, false],
  ])("warns on %s: %p", (_name, context, warns) => {
    const result = validateBody(OVERLONG_PROSE, context);
    expect(getAdditionalContext(result)?.includes("repo you own") ?? false).toBe(warns);
  });

  it("does not warn on a short body in a personal repo", () => {
    expect(
      validateBody("Adds an LRU cache to the resolver.", { title: null, personalRepo: true }),
    ).toBeNull();
  });

  test.each<[string, string, string | undefined]>([
    [
      "a title past the length limit",
      "Add an LRU Cache to the Resolver and Wire It Through",
      "characters",
    ],
    ["an enumerating title", "Add a Cache, Wire It Up, and Log Misses", "enumerates"],
    ["a single-clause title", "Add an LRU Cache", undefined],
  ])("warns on %s", (_name, title, fragment) => {
    const result = validateBody("Adds an LRU cache to the resolver.", {
      title,
      personalRepo: false,
    });
    if (fragment === undefined) {
      expect(result).toBeNull();
      return;
    }
    expect(getAdditionalContext(result)).toContain(fragment);
  });
});

describe("hasCiStatusRollCall", () => {
  test.each<[string, string]>([
    ["all green", "Everything is all green."],
    ["zero errors/warnings", "skill-lint: 0 errors, 0 warnings"],
    ["lint passes", "Lint passes on all six skills."],
    ["build green", "The build is green."],
    ["tests pass", "The unit tests pass."],
    ["types clean", "Types clean after the change."],
  ])("flags %s", (_name, body) => {
    expect(hasCiStatusRollCall(body)).toBe(true);
  });

  test.each<[string, string]>([
    ["pass as a verb", "The existing section tests already pass VARCHAR literals."],
    ["callers passing an argument", "All four sites now pass `env.KV`."],
    ["falsification with fail", "Reverting the fix makes `TestX` fail with exit 2."],
    ["green as a color noun", "The status badge renders green for the healthy state."],
    ["clean describing code", "The teardown leaves a clean working tree."],
  ])("does not flag %s", (_name, body) => {
    expect(hasCiStatusRollCall(body)).toBe(false);
  });
});

describe("hasRunOnProse", () => {
  const commaSplice = `Reshapes the resolver so it reads ${"the cache, then the database, then the network, then the stale fallback, ".repeat(3)}before it finally gives up on the request.`;

  test.each<[string, string]>([
    [
      "a paragraph over four sentences",
      "It reads. It falls back. It retries. It logs. It gives up.",
    ],
    [
      "a sentence past the run-on length",
      `Reshapes the resolver ${"and threads the request through another layer ".repeat(7)}now.`,
    ],
    ["a comma-stacked enumeration", commaSplice],
  ])("flags %s", (_name, body) => {
    expect(hasRunOnProse(body)).toBe(true);
  });

  test.each<[string, string]>([
    ["a tight paragraph", "Reshapes the resolver. It reads the cache before the database."],
    ["four short sentences", "One. Two. Three. Four."],
    ["sentences buried in fenced code", "```\nlong. run. on. wall. of. code.\n```"],
    ["a list of many items", "- one\n- two\n- three\n- four\n- five\n- six"],
  ])("does not flag %s", (_name, body) => {
    expect(hasRunOnProse(body)).toBe(false);
  });
});

describe("hasReflexiveScaffold", () => {
  test.each<[string, string, boolean]>([
    [
      "flags a small body with both Changes and Testing headings",
      "## Changes\n\n- x\n\n## Testing\n\ny",
      true,
    ],
    ["does not flag when only one heading is present", "## Changes\n\n- x", false],
    [
      "does not flag a body at or over the word limit",
      `${LONG_PROSE}\n\n## Changes\n\n- x\n\n## Testing\n\ny`,
      false,
    ],
  ])("%s", (_name, input, expected) => {
    expect(hasReflexiveScaffold(input)).toBe(expected);
  });
});

describe("hasFileTourBullets", () => {
  test.each<[string, string, boolean]>([
    ["flags a bold label with a path separator", "- **src/cache.ts**: adds a cache", true],
    ["flags a bold label that ends in a file extension", "* **cache.ts**: adds a cache", true],
    [
      "flags a bold label wrapped in backticks denoting a path",
      "- **`lib/foo.ts`**: refactors it",
      true,
    ],
    ["does not flag a plain concept label", "- **Caching**: stores records in memory", false],
    [
      "does not flag a multi-word concept label",
      "- **Retry logic**: backs off exponentially",
      false,
    ],
  ])("%s", (_name, input, expected) => {
    expect(hasFileTourBullets(input)).toBe(expected);
  });
});

describe("extractBacktickedHexCandidates", () => {
  const sha40 = "2554da150000000000000000000000000000abcd";

  test.each<[string, string, string[]]>([
    ["pulls a backticked short SHA", "a `2554da15` b", ["2554da15"]],
    ["returns a backticked 40-char SHA", `Builds on \`${sha40}\`.`, [sha40]],
    ["ignores a bare (unbackticked) hex run", "commit 2554da15 landed", []],
    ["ignores a backticked non-hex identifier", "calls `getUser` then", []],
    ["ignores a backticked file path", "see `src/cache.ts`", []],
  ])("%s", (_name, input, expected) => {
    expect(extractBacktickedHexCandidates(input)).toEqual(expected);
  });
});

describe("findBacktickedCommits", () => {
  const known = new Set(["2554da15", "dc8acf12"]);
  const fakeVerifier = (sha: string) => Promise.resolve(known.has(sha));

  test.each<[string, string, string[]]>([
    ["returns candidates the verifier confirms", "Builds on `2554da15`.", ["2554da15"]],
    ["drops a hex candidate the verifier rejects", "random `deadbeef` hash", []],
  ])("%s", async (_name, input, expected) => {
    const candidates = extractBacktickedHexCandidates(input);
    expect(await findBacktickedCommits(candidates, fakeVerifier)).toEqual(expected);
  });
});

describe("hasBacktickedRef", () => {
  test.each<[string, string, boolean]>([
    ["flags a backticked issue/PR ref", "Closes `#123`", true],
    ["flags a backticked GitLab MR ref", "See `!45`", true],
    ["flags a backticked cross-repo ref", "Relates to `owner/repo#12`", true],
    ["does not flag a bare ref", "Closes #123", false],
    ["does not flag a backticked mention", "thanks `@user`", false],
    ["does not flag a backticked CSS id", "the `#main` selector", false],
  ])("%s", (_name, input, expected) => {
    expect(hasBacktickedRef(input)).toBe(expected);
  });
});

describe("findNarrationTells", () => {
  test.each<[string, string, NarrationTell[]]>([
    ["flags a deliberate-choice claim", "The retry count is deliberately low.", ["deliberately"]],
    ["flags a worth-noting frame", "Worth noting: the cache is cold on boot.", ["worth noting"]],
    ["flags a hyphenated tell", "The ordering here is non-obvious.", ["non-obvious"]],
    ["flags a tell split across a line break", "Timeouts are left\nalone.", ["left alone"]],
    ["ignores a tell inside a fence", "```\ndeliberately\n```", []],
    ["ignores a longer word that contains a tell", "The deliberateness of it.", []],
    ["ignores plain prose", "Adds an LRU cache to the resolver.", []],
  ])("%s", (_name, body, expected) => {
    expect(findNarrationTells(body)).toEqual(expected);
  });
});

describe("sentenceShapedHeadings", () => {
  test.each<[string, string, string[]]>([
    ["flags an interrogative label", "## Why This Happens", ["Why This Happens"]],
    ["flags a linking verb", "## The Cache Is Cold on Boot", ["The Cache Is Cold on Boot"]],
    [
      "reads a heading through its emphasis",
      "## **The Cache Is Cold on Boot**",
      ["The Cache Is Cold on Boot"],
    ],
    ["ignores a noun-phrase label", "## Changes", []],
    ["ignores a deverbal compound", "## Future Work", []],
    ["ignores a plural deverbal compound", "## Bug Fixes", []],
    ["ignores the guidance's own heading", "## Deferred Work", []],
    ["ignores a heading the case checker already owns", "## Changes to the cache", []],
    ["ignores a code-led label", "## `validate.ts` Rewrite", []],
    ["ignores a heading inside a fence", "```\n## Why This Happens\n```", []],
  ])("%s", (_name, body, expected) => {
    expect(sentenceShapedHeadings(body).map((heading) => heading.text)).toEqual(expected);
  });
});

describe("extractTitle", () => {
  test.each<[string, string | null]>([
    ['gh pr create --title "Add an LRU Cache"', "Add an LRU Cache"],
    ["gh pr create --title 'Add an LRU Cache'", "Add an LRU Cache"],
    ['gh pr create --title="Add an LRU Cache"', "Add an LRU Cache"],
    ["gh pr create -t 'Add an LRU Cache'", "Add an LRU Cache"],
    ["gh pr create --title cache", "cache"],
    ['gh pr create --title "a \\"quoted\\" word"', 'a "quoted" word'],
    ['glab mr create --title "Add an LRU Cache" --description x', "Add an LRU Cache"],
    ["gh pr edit 12 --body-file body.md", null],
    ['BODY=$(mktemp -t pr) && gh pr create --title "Real Title" --body-file "$BODY"', "Real Title"],
    ['gh pr create --body "use tar -t archive.tar to list" --title "Real Title"', "Real Title"],
    ['gh pr edit 12 --body "documents the --title flag for the scaffolder"', null],
  ])("extractTitle(%p) -> %p", (command, expected) => {
    expect(extractTitle(command)).toBe(expected);
  });
});

describe("parseRemote", () => {
  test.each<[string, { host: string; owner: string } | null]>([
    ["git@github.com:bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["https://github.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["ssh://git@github.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["https://gitlab.com/group/subgroup/project.git", { host: "gitlab.com", owner: "group" }],
    [
      "git@github.mycorp.com:bendrucker/service.git",
      { host: "github.mycorp.com", owner: "bendrucker" },
    ],
    ["https://GitHub.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["/Users/ben/src/claude", null],
  ])("parseRemote(%p) -> %p", (url, expected) => {
    expect(parseRemote(url)).toEqual(expected);
  });
});

describe("parseGhLogin", () => {
  test.each<[string, string, string | null]>([
    [
      "reads the user under github.com",
      "github.com:\n    user: bendrucker\n    git_protocol: ssh\n",
      "bendrucker",
    ],
    ["strips quotes around the value", 'github.com:\n    user: "bendrucker"\n', "bendrucker"],
    [
      "skips another host's user",
      "ghe.example.com:\n    user: someone\ngithub.com:\n    user: bendrucker\n",
      "bendrucker",
    ],
    ["returns null without a github.com block", "ghe.example.com:\n    user: someone\n", null],
    ["returns null when the block has no user", "github.com:\n    git_protocol: ssh\n", null],
    ["returns null for an empty file", "", null],
  ])("%s", (_name, hosts, expected) => {
    expect(parseGhLogin(hosts)).toBe(expected);
  });
});

describe("isPersonalRepo", () => {
  const hosts = "github.com:\n    user: bendrucker\n";

  test.each<[string, string | null, string | null, boolean]>([
    ["matches the authenticated login", "git@github.com:bendrucker/claude.git", hosts, true],
    ["matches regardless of case", "git@github.com:BenDrucker/claude.git", hosts, true],
    ["rejects another owner", "git@github.com:anthropics/claude.git", hosts, false],
    [
      "rejects a matching owner on another host",
      "git@github.mycorp.com:bendrucker/service.git",
      hosts,
      false,
    ],
    [
      "rejects a matching namespace on gitlab",
      "git@gitlab.com:bendrucker/service.git",
      hosts,
      false,
    ],
    ["skips without a remote", null, hosts, false],
    ["skips without a gh config", "git@github.com:bendrucker/claude.git", null, false],
    [
      "skips when the config holds no github.com login",
      "git@github.com:bendrucker/claude.git",
      "ghe.example.com:\n    user: someone\n",
      false,
    ],
  ])("%s", (_name, remote, hostsYaml, expected) => {
    expect(isPersonalRepo(remote, hostsYaml)).toBe(expected);
  });
});

describe("processInput", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const repoRoot = path.join(import.meta.dir, "..", "..", "..");
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })
    .stdout.trim()
    .slice(0, 12);

  function createInput(command: string, cwd?: string): HookInput {
    return { tool_input: { command }, ...(cwd != null && cwd !== "" && { cwd }) };
  }

  it("returns null when command has no --body-file", async () => {
    const result = await processInput(createInput("gh pr create --title 'Test'"));
    expect(result).toBeNull();
  });

  // A dispatch that escapes the `if` rules must stay inert, including one that
  // names a body file the hook must not read.
  test.each<[string]>([["ls -la"], ["cat /tmp/body.md"], ["{ echo one; echo two; }"]])(
    "returns null for unrelated command %p",
    async (command) => {
      expect(await processInput(createInput(command))).toBeNull();
    },
  );

  it("returns null when tool_input has no command", async () => {
    const result = await processInput({ tool_input: {} });
    expect(result).toBeNull();
  });

  // A skipped check must not read as a clean body, so the one case the hook
  // cannot inspect is the one case it refuses outright.
  test.each<[string, string]>([
    ["gh pr create --body-file /nonexistent.md", "/nonexistent.md"],
    ['glab mr create --description "$(cat /nonexistent.md)"', "/nonexistent.md"],
    ['glab mr create --description "$(git log --oneline)"', "$(git log --oneline)"],
    ["glab mr update 3 --description-file -", "standard input"],
  ])("denies %p, which it cannot read", async (command, fragment) => {
    const result = await processInput(createInput(command));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain(fragment);
    expect(getDenyReason(result)).toContain("none of the body checks ran");
  });

  it("returns null for valid body", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Summary\nFixes a bug");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).toBeNull();
  });

  // Every shape a PR/MR body arrives in, bound to the same deny. The GitLab
  // rows are the ones the hook used to wave through: a `--description` value is
  // the only way `glab` took a body before `--description-file`, and neither
  // reached the checks.
  test.each<[string, (body: string) => string]>([
    ["gh pr create --body-file", (body) => `gh pr create --title T --body-file ${body}`],
    ["gh pr edit --body-file", (body) => `gh pr edit 12 --body-file ${body}`],
    ["gh pr create --body", (body) => `gh pr create --title T --body "$(cat ${body})"`],
    [
      "glab mr create --description-file",
      (body) => `glab mr create --title T --description-file ${body}`,
    ],
    ["glab mr update --description-file", (body) => `glab mr update 3 --description-file ${body}`],
    [
      "glab mr create --description",
      (body) => `glab mr create --title T --description "$(cat ${body})"`,
    ],
    ["glab mr update --description", (body) => `glab mr update 3 --description "$(cat ${body})"`],
    ["glab mr update -d", (body) => `glab mr update 3 -d "$(cat ${body})"`],
  ])("checks the body behind %s", async (_form, build) => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Two fixes found while testing\n\nReshapes the resolver.");
    const result = await processInput(createInput(build(bodyFile), repoRoot));
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
  });

  it("denies body with test count", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Test plan\nAdded 5 tests");
    const result = await processInput(createInput(`gh pr create --body-file ${bodyFile}`));
    expect(result).not.toBeNull();
    expect(getPermissionDecision(result)).toBe("deny");
  });

  it("denies a backticked real commit SHA", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("auto-link");
  });

  it("reports a verified SHA once when the body also has a backticked ref", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`. Closes \`#12\`.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)?.match(/auto-link/g)).toHaveLength(1);
  });

  it("does not warn on a bare commit SHA", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on ${headSha}.`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(result).toBeNull();
  });

  it("denies a sentence-case heading in a body file", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Two fixes found while testing\n\nReshapes the resolver.");
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("Two Fixes Found While Testing");
  });

  it("combines a test-count and a backticked SHA into one deny", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, `Builds on \`${headSha}\`.\n\nAdded 5 tests`);
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    const reason = getDenyReason(result);
    expect(reason).toContain("- Testing section should not mention test counts");
    expect(reason).toContain("- Commit SHAs and issue/MR refs");
  });

  it("warns on the title the command sets", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "Adds an LRU cache to the resolver.");
    const result = await processInput(
      createInput(
        `gh pr create --title "Add an LRU Cache to the Resolver and Wire It Through" --body-file ${bodyFile}`,
        repoRoot,
      ),
    );
    expect(getAdditionalContext(result)).toContain("characters");
  });

  it("carries the title warning into the deny when the body file is missing", async () => {
    const result = await processInput(
      createInput(
        `gh pr create --title "Add an LRU Cache to the Resolver and Wire It Through" --body-file ${path.join(tempDir, "missing.md")}`,
        repoRoot,
      ),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain("none of the body checks ran");
    expect(getDenyReason(result)).toContain("characters");
  });

  it("stays silent on a title-only command with a clean title", async () => {
    const result = await processInput(
      createInput('gh pr edit 12 --title "Add an LRU Cache"', repoRoot),
    );
    expect(result).toBeNull();
  });

  it("carries warnings inside the deny instead of a separate warn", async () => {
    const bodyFile = path.join(tempDir, "body.md");
    await Bun.write(bodyFile, "## Changes to the cache\n\n- **src/cache.ts**: adds a cache");
    const result = await processInput(
      createInput(`gh pr create --body-file ${bodyFile}`, repoRoot),
    );
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getAdditionalContext(result)).toBeUndefined();
    expect(getDenyReason(result)).toContain("Also worth addressing in the same edit:");
  });
});

// Greedy fill at a column: the thing the detector exists to catch. `indent`
// prefixes continuation lines so a wrapped list item keeps its hanging indent.
function wrapAt(text: string, column: number, indent = ""): string {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > column && current !== "") {
      lines.push(current);
      current = indent + word;
      continue;
    }
    current = candidate;
  }
  lines.push(current);
  return lines.join("\n");
}

// Greedy fill leaves a line longer than column - (MAX_WORD + 1) and never
// longer than column. Deriving the column floor from that keeps every generated
// non-final line inside [WRAP_MIN_LINE, WRAP_MAX_LINE], so the generator only
// emits documents the detector actually claims to catch.
const MAX_WORD = 9;
const MIN_COLUMN = WRAP_MIN_LINE + MAX_WORD + 1;
const MAX_COLUMN = WRAP_MAX_LINE;

const word = fc
  .string({
    minLength: 3,
    maxLength: MAX_WORD,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
  })
  .filter((w) => w.length >= 3);

/** A block long enough to wrap at any column in range: at least 25 words. */
const block = fc.array(word, { minLength: 25, maxLength: 60 }).map((words) => words.join(" "));

const wrapColumn = fc.integer({ min: MIN_COLUMN, max: MAX_COLUMN });

/** A document of one-line paragraphs and one-line list items. */
const proseDocument = fc
  .array(fc.record({ text: block, bullet: fc.boolean() }), { minLength: 1, maxLength: 4 })
  .map((blocks) => blocks.map(({ text, bullet }) => (bullet ? `- ${text}` : text)).join("\n\n"));

function wrapDocument(doc: string, column: number): string {
  return doc
    .split("\n\n")
    .map((b) => (b.startsWith("- ") ? wrapAt(b, column, "  ") : wrapAt(b, column)))
    .join("\n\n");
}

/**
 * What the body renders to. Positions differ after an unwrap by construction,
 * and mdast keeps the newline inside a text node's value, so both are normalized
 * away. What survives is the structure a reader sees.
 */
function renderedShape(body: string): string {
  return JSON.stringify(fromMarkdown(body), (key, value) => {
    if (key === "position") return undefined;
    if (key === "value" && typeof value === "string") return value.replace(/\s+/g, " ");
    return value;
  });
}

describe("hardWrappedParagraphs", () => {
  it("flags a document wrapped at any column in range", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        expect(hardWrappedParagraphs(wrapDocument(doc, column)).length).toBeGreaterThan(0);
      }),
    );
  });

  it("leaves a document alone when every block is on one line", () => {
    fc.assert(
      fc.property(proseDocument, (doc) => {
        expect(hardWrappedParagraphs(doc)).toEqual([]);
      }),
    );
  });

  it("recovers the original document when unwrapping a wrapped one", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        expect(unwrapBody(wrapDocument(doc, column))).toBe(doc);
      }),
    );
  });

  it("converges in one pass, so a single retry always clears the deny", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        expect(hardWrappedParagraphs(unwrapBody(wrapDocument(doc, column)))).toEqual([]);
      }),
    );
  });

  it("never changes what the body renders to", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        const wrapped = wrapDocument(doc, column);
        expect(renderedShape(unwrapBody(wrapped))).toBe(renderedShape(wrapped));
      }),
    );
  });

  const LONG = "The resolver caches every lookup it performs and evicts on a timer";

  test.each<[string, string, boolean]>([
    ["wrapped paragraph", `${LONG} that\n${LONG} runs every thirty seconds here.`, true],
    ["one-line paragraph", `${LONG} that runs every thirty seconds.`, false],
    ["wrapped list item", `- ${LONG} that\n  ${LONG} runs every thirty seconds here.`, true],
    ["one-line list items", `- ${LONG} once.\n- ${LONG} twice.`, false],
    [
      "table",
      "| Month | Rate | Notes about the month that make the row long |\n|---|---|---|\n| June | 0.5% | The rate was low and stayed low all month |",
      false,
    ],
    ["fenced code", `\`\`\`ts\nconst first = "${LONG}";\nconst second = "${LONG}";\n\`\`\``, false],
    ["two-space hard break", `${LONG} that  \n${LONG} runs every thirty seconds here.`, false],
    [
      "short deliberate lines",
      "Discovery: 8a4c11372239\nDiscovery: 7b7e5d6ca37e\nDiscovery: db1ce0b102e0",
      false,
    ],
    [
      "line past the ceiling",
      `${LONG} and it also does a great many other things besides that one.\n${LONG} here.`,
      false,
    ],
    ["nested list", `- ${LONG} once.\n  - ${LONG} twice.`, false],
  ])("%s", (_name, body, expected) => {
    expect(hardWrappedParagraphs(body).length > 0).toBe(expected);
  });
});

describe("validateBody wrapping", () => {
  it("denies a wrapped body and hands back the corrected paragraph", () => {
    const body =
      "The resolver caches every lookup it performs and evicts\non a timer that runs every thirty seconds in the background.";
    const result = validateBody(body);
    expect(getPermissionDecision(result)).toBe("deny");
    expect(getDenyReason(result)).toContain(
      "The resolver caches every lookup it performs and evicts on a timer that runs every thirty seconds in the background.",
    );
  });
});
