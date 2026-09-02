import { describe, expect, test } from "bun:test";
import {
  type BodyContext,
  type RuleId,
  type RuleMatch,
  scanBody,
  validateBody,
} from "./body-rules";

// Four short sentences, 29 words. Bulk for a test that needs a large body,
// without tripping the run-on detector on its own.
const PROSE_PARAGRAPH =
  "The cache stores frequently accessed records in memory. It evicts the oldest entry when full. A configurable TTL bounds staleness. Reads fall back to the database on a miss.";

// Clears the small-body word limit.
const LONG_PROSE = Array(6).fill(PROSE_PARAGRAPH).join("\n\n");

// Clears the personal-repo word limit.
const OVERLONG_PROSE = Array(16).fill(PROSE_PARAGRAPH).join("\n\n");

const SHA40 = "2554da150000000000000000000000000000abcd";
const KNOWN_COMMITS = new Set(["2554da15", "dc8acf12", SHA40]);
const repo: Partial<BodyContext> = { hasCommit: (sha) => Promise.resolve(KNOWN_COMMITS.has(sha)) };
const personal: Partial<BodyContext> = { personalRepo: () => Promise.resolve(true) };
const titled = (title: string): Partial<BodyContext> => ({ title });

interface Row {
  name: string;
  body: string;
  context?: Partial<BodyContext>;
  fires: RuleId[];
}

async function fired(
  tier: RuleMatch["tier"],
  body: string,
  context?: Partial<BodyContext>,
): Promise<RuleId[]> {
  const matches = await scanBody(body, context);
  return matches.filter((match) => match.tier === tier).map((match) => match.id);
}

describe("deny rules", () => {
  test.each<Row>([
    {
      name: "clean body",
      body: "## Summary\nFixes a bug\n\n## Test Plan\nUnit tests cover the fix",
      fires: [],
    },
    {
      name: "'Added N tests'",
      body: "## Testing\nAdded 5 tests for the new feature",
      fires: ["test-count"],
    },
    { name: "'Added N unit tests'", body: "## Testing\nAdded 3 unit tests", fires: ["test-count"] },
    {
      name: "'Added N integration tests'",
      body: "## Testing\nAdded 2 integration tests",
      fires: ["test-count"],
    },
    { name: "'N tests'", body: "## Testing\n5 tests verify the behavior", fires: ["test-count"] },
    { name: "lowercase 'added'", body: "## Testing\nadded 10 tests", fires: ["test-count"] },
    {
      name: "assertion count",
      body: "## Testing\nThe suite runs 1165 assertions.",
      fires: ["test-count"],
    },
    {
      name: "pass/fail count",
      body: "## Testing\n`bun test`: 193 pass, 0 fail.",
      fires: ["test-count"],
    },
    {
      name: "sentence-case heading",
      body: "## Two fixes found while testing\n\nReshapes the resolver.",
      fires: ["heading-case"],
    },
    {
      name: "heading with inline code",
      body: "## changes to `validate.ts`\n\nReshapes the resolver.",
      fires: ["heading-case"],
    },
    {
      name: "AP-cased headings with an acronym",
      body: "## API Changes\n\nAdds an endpoint.\n\n## Changes to the Parser\n\nRewrites it.",
      fires: [],
    },
    { name: "backticked issue ref", body: "Closes `#123`.", fires: ["backticked-ref"] },
    { name: "backticked MR ref", body: "Supersedes `!45`.", fires: ["backticked-ref"] },
    {
      name: "backticked cross-repo ref",
      body: "Relates to `owner/repo#12`",
      fires: ["backticked-ref"],
    },
    { name: "bare ref", body: "Closes #123", fires: [] },
    { name: "backticked mention", body: "thanks `@user`", fires: [] },
    { name: "backticked CSS id", body: "the `#main` selector", fires: [] },
    {
      name: "backticked short SHA the repo knows",
      body: "Builds on `2554da15`.",
      context: repo,
      fires: ["backticked-ref"],
    },
    {
      name: "backticked 40-char SHA the repo knows",
      body: `Builds on \`${SHA40}\`.`,
      context: repo,
      fires: ["backticked-ref"],
    },
    {
      name: "backticked hex the repo rejects",
      body: "random `deadbeef` hash",
      context: repo,
      fires: [],
    },
    { name: "bare SHA", body: "commit 2554da15 landed", context: repo, fires: [] },
    {
      name: "backticked non-hex identifier",
      body: "calls `getUser` then",
      context: repo,
      fires: [],
    },
    { name: "backticked file path", body: "see `src/cache.ts`", context: repo, fires: [] },
    {
      name: "hard-wrapped paragraph",
      body: "The resolver caches every lookup it performs and evicts\non a timer that runs every thirty seconds in the background.",
      fires: ["hard-wrap"],
    },
    {
      name: "every deny at once",
      body: "## Two fixes found while testing\n\nAdded 5 tests. Closes `#12`.",
      fires: ["test-count", "heading-case", "backticked-ref"],
    },
    {
      name: "test count under a scaffold",
      body: "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nAdded 5 tests",
      fires: ["test-count"],
    },
    {
      name: "unreadable body",
      body: "",
      context: { unreadable: "a body typed into an editor (`-`)" },
      fires: ["unreadable-body"],
    },
  ])("$name", async ({ body, context, fires }) => {
    expect(await fired("deny", body, context)).toEqual(fires);
  });
});

describe("warn rules", () => {
  const commaSplice = `Reshapes the resolver so it reads ${"the cache, then the database, then the network, then the stale fallback, ".repeat(3)}before it finally gives up on the request.`;

  test.each<Row>([
    {
      name: "clean body",
      body: "## Summary\nFixes a bug\n\n## Test Plan\nUnit tests cover the fix",
      fires: [],
    },
    { name: "all green", body: "Everything is all green.", fires: ["ci-status"] },
    {
      name: "zero errors/warnings",
      body: "skill-lint: 0 errors, 0 warnings",
      fires: ["ci-status"],
    },
    { name: "lint passes", body: "Lint passes on all six skills.", fires: ["ci-status"] },
    { name: "build green", body: "The build is green.", fires: ["ci-status"] },
    { name: "tests pass", body: "The unit tests pass.", fires: ["ci-status"] },
    { name: "types clean", body: "Types clean after the change.", fires: ["ci-status"] },
    {
      name: "roll-call in a paragraph",
      body: "Adds an LRU cache to the resolver.\n\nLint passes and the build is green.\n\nFixes #1",
      fires: ["ci-status"],
    },
    {
      name: "pass as a verb",
      body: "The existing section tests already pass VARCHAR literals.",
      fires: [],
    },
    { name: "callers passing an argument", body: "All four sites now pass `env.KV`.", fires: [] },
    {
      name: "falsification with fail",
      body: "Reverting the fix makes `TestX` fail with exit 2.",
      fires: [],
    },
    {
      name: "green as a color noun",
      body: "The status badge renders green for the healthy state.",
      fires: [],
    },
    { name: "clean describing code", body: "The teardown leaves a clean working tree.", fires: [] },
    {
      name: "paragraph over four sentences",
      body: "It reads. It falls back. It retries. It logs. It gives up.",
      fires: ["run-on-prose"],
    },
    {
      name: "sentence past the run-on length",
      body: `Reshapes the resolver ${"and threads the request through another layer ".repeat(7)}now.`,
      fires: ["run-on-prose"],
    },
    { name: "comma-stacked enumeration", body: commaSplice, fires: ["run-on-prose"] },
    {
      name: "five-sentence paragraph with a trailer",
      body: "Reshapes the resolver. It reads the cache first. It falls back to the database. It then tries the network. It retries once before giving up.\n\nFixes #1",
      fires: ["run-on-prose"],
    },
    {
      name: "tight paragraph",
      body: "Reshapes the resolver. It reads the cache before the database.",
      fires: [],
    },
    { name: "four short sentences", body: "One. Two. Three. Four.", fires: [] },
    {
      name: "sentences buried in fenced code",
      body: "```\nlong. run. on. wall. of. code.\n```",
      fires: [],
    },
    { name: "list of many items", body: "- one\n- two\n- three\n- four\n- five\n- six", fires: [] },
    {
      name: "small body with Changes and Testing",
      body: "## Changes\n\n- x\n\n## Testing\n\ny",
      fires: ["reflexive-scaffold"],
    },
    {
      name: "small scaffold with a trailer",
      body: "## Changes\n\n- Adds a flag\n\n## Testing\n\nRan the suite.\n\nFixes #1",
      fires: ["reflexive-scaffold"],
    },
    { name: "only one scaffold heading", body: "## Changes\n\n- x", fires: [] },
    {
      name: "scaffold at the word limit",
      body: `${LONG_PROSE}\n\n## Changes\n\n- x\n\n## Testing\n\ny`,
      fires: [],
    },
    {
      name: "large PR with earned sections",
      body: `${LONG_PROSE}\n\n## Changes\n\n- Adds the LRU cache\n\n## Testing\n\nManual exercise of expiry and eviction.`,
      fires: [],
    },
    {
      name: "bold label with a path separator",
      body: "- **src/cache.ts**: adds a cache",
      fires: ["file-tour"],
    },
    {
      name: "bold label ending in a file extension",
      body: "* **cache.ts**: adds a cache",
      fires: ["file-tour"],
    },
    {
      name: "bold label wrapped in backticks",
      body: "- **`lib/foo.ts`**: refactors it",
      fires: ["file-tour"],
    },
    {
      name: "file tour under a Changes heading",
      body: "## Changes\n\n- **src/cache.ts**: adds an LRU cache\n- **src/index.ts**: wires it up",
      fires: ["file-tour"],
    },
    { name: "plain concept label", body: "- **Caching**: stores records in memory", fires: [] },
    {
      name: "multi-word concept label",
      body: "- **Retry logic**: backs off exponentially",
      fires: [],
    },
    {
      name: "concept-labeled bullets under Changes",
      body: "## Changes\n\n- **Caching**: stores records in memory\n- **Eviction**: drops the oldest entry",
      fires: [],
    },
    {
      name: "scaffold and file tour together",
      body: "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nManual.",
      fires: ["reflexive-scaffold", "file-tour"],
    },
    {
      name: "deliberate-choice claim",
      body: "The retry count is deliberately low.",
      fires: ["narration"],
    },
    {
      name: "worth-noting frame",
      body: "Worth noting: the cache is cold on boot.",
      fires: ["narration"],
    },
    { name: "hyphenated tell", body: "The ordering here is non-obvious.", fires: ["narration"] },
    {
      name: "tell split across a line break",
      body: "Timeouts are left\nalone.",
      fires: ["narration"],
    },
    { name: "tell inside a fence", body: "```\ndeliberately\n```", fires: [] },
    { name: "longer word containing a tell", body: "The deliberateness of it.", fires: [] },
    { name: "plain prose", body: "Adds an LRU cache to the resolver.", fires: [] },
    { name: "interrogative heading", body: "## Why This Happens", fires: ["sentence-heading"] },
    {
      name: "linking-verb heading",
      body: "## The Cache Is Cold on Boot",
      fires: ["sentence-heading"],
    },
    {
      name: "emphasized sentence heading",
      body: "## **The Cache Is Cold on Boot**",
      fires: ["sentence-heading"],
    },
    {
      name: "sentence heading over prose",
      body: "## Why the Cache Is Cold\n\nAdds an LRU cache to the resolver.",
      fires: ["sentence-heading"],
    },
    { name: "noun-phrase heading", body: "## Changes", fires: [] },
    { name: "deverbal compound heading", body: "## Future Work", fires: [] },
    { name: "plural deverbal compound heading", body: "## Bug Fixes", fires: [] },
    { name: "the guidance's own heading", body: "## Deferred Work", fires: [] },
    { name: "heading the case rule already owns", body: "## Changes to the cache", fires: [] },
    { name: "code-led heading", body: "## `validate.ts` Rewrite", fires: [] },
    { name: "heading inside a fence", body: "```\n## Why This Happens\n```", fires: [] },
    {
      name: "AP-cased headings with an acronym",
      body: "## API Changes\n\nAdds an endpoint.\n\n## Changes to the Parser\n\nRewrites it.",
      fires: [],
    },
    {
      name: "long body on a personal repo",
      body: OVERLONG_PROSE,
      context: personal,
      fires: ["personal-length"],
    },
    { name: "long body on a shared repo", body: OVERLONG_PROSE, fires: [] },
    {
      name: "short body on a personal repo",
      body: "Adds an LRU cache to the resolver.",
      context: personal,
      fires: [],
    },
    {
      name: "title past the length limit",
      body: "Adds an LRU cache to the resolver.",
      context: titled("Add an LRU Cache to the Resolver and Wire It Through"),
      fires: ["title-length"],
    },
    {
      name: "enumerating title",
      body: "Adds an LRU cache to the resolver.",
      context: titled("Add a Cache, Wire It Up, and Log Misses"),
      fires: ["title-clauses"],
    },
    {
      name: "single-clause title",
      body: "Adds an LRU cache to the resolver.",
      context: titled("Add an LRU Cache"),
      fires: [],
    },
    {
      name: "title on an unreadable body",
      body: "",
      context: {
        ...titled("Add an LRU Cache to the Resolver and Wire It Through"),
        unreadable: "standard input",
      },
      fires: ["title-length"],
    },
  ])("$name", async ({ body, context, fires }) => {
    expect(await fired("warn", body, context)).toEqual(fires);
  });
});

describe("rule messages", () => {
  test.each<{
    name: string;
    body: string;
    context?: Partial<BodyContext>;
    id: RuleId;
    fragments: string[];
  }>([
    {
      name: "test count",
      body: "## Testing\nAdded 5 tests",
      id: "test-count",
      fragments: ["test counts"],
    },
    {
      name: "heading suggestion",
      body: "## Two fixes found while testing\n\nReshapes it.",
      id: "heading-case",
      fragments: [
        '"Two fixes found while testing" → "Two Fixes Found While Testing"',
        "proper noun, code identifier",
      ],
    },
    {
      name: "inline code survives the suggestion",
      body: "## changes to `validate.ts`\n\nReshapes it.",
      id: "heading-case",
      fragments: ['"changes to `validate.ts`" → "Changes to `validate.ts`"'],
    },
    { name: "auto-link", body: "Closes `#123`.", id: "backticked-ref", fragments: ["auto-link"] },
    {
      name: "unwrapped paragraph",
      body: "The resolver caches every lookup it performs and evicts\non a timer that runs every thirty seconds in the background.",
      id: "hard-wrap",
      fragments: [
        "The resolver caches every lookup it performs and evicts on a timer that runs every thirty seconds in the background.",
      ],
    },
    {
      name: "unreadable body",
      body: "",
      context: { unreadable: "standard input" },
      id: "unreadable-body",
      fragments: ["standard input", "none of the body checks ran"],
    },
    {
      name: "scaffold",
      body: "## Changes\n\n- x\n\n## Testing\n\ny",
      id: "reflexive-scaffold",
      fragments: ["scaffold"],
    },
    {
      name: "file tour",
      body: "- **src/cache.ts**: adds a cache",
      id: "file-tour",
      fragments: ["file by file"],
    },
    {
      name: "status checks",
      body: "The build is green.",
      id: "ci-status",
      fragments: ["status checks"],
    },
    {
      name: "run-on",
      body: "It reads. It falls back. It retries. It logs. It gives up.",
      id: "run-on-prose",
      fragments: ["runs long"],
    },
    {
      name: "narration names its tells",
      body: "The retry count is deliberately low. Left alone: the socket timeout.",
      id: "narration",
      fragments: ['"deliberately"', '"left alone"'],
    },
    {
      name: "sentence heading",
      body: "## Why the Cache Is Cold",
      id: "sentence-heading",
      fragments: ["read as sentences", '"Why the Cache Is Cold"'],
    },
    {
      name: "personal length",
      body: OVERLONG_PROSE,
      context: personal,
      id: "personal-length",
      fragments: ["repo you own"],
    },
    {
      name: "title length",
      body: "",
      context: titled("Add an LRU Cache to the Resolver and Wire It Through"),
      id: "title-length",
      fragments: ["characters"],
    },
    {
      name: "title clauses",
      body: "",
      context: titled("Add a Cache, Wire It Up, and Log Misses"),
      id: "title-clauses",
      fragments: ["enumerates"],
    },
  ])("$name", async ({ body, context, id, fragments }) => {
    const message = (await scanBody(body, context)).find((match) => match.id === id)?.message;
    for (const fragment of fragments) expect(message).toContain(fragment);
  });
});

describe("validateBody", () => {
  test.each<[string, string, Partial<BodyContext>]>([
    [
      "bundles every deny and folds the warns in",
      "## Two fixes found while testing\n\nAdded 5 tests. Closes `#12`.\n\n- **src/cache.ts**: adds a cache",
      {},
    ],
    [
      "carries a title warn into an unreadable-body deny",
      "",
      {
        title: "Add an LRU Cache to the Resolver and Wire It Through",
        unreadable: "standard input",
      },
    ],
    [
      "lists several warns",
      "## Changes\n\n- **src/cache.ts**: adds a cache\n\n## Testing\n\nManual.",
      {},
    ],
    ["notes a single warn", "The build is green.", {}],
    ["stays silent on a clean body", "## Summary\n\nFixes a bug.", {}],
  ])("%s", async (_name, body, context) => {
    expect(await validateBody(body, context)).toMatchSnapshot();
  });
});
