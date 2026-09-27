import { describe, expect, test } from "bun:test";
import { literal, parseShell, type ShellCommand } from "./shell";

// The parse layer is what every body rule stands on.
function summarize(command: string, env: NodeJS.ProcessEnv = {}) {
  return parseShell(command, env).map((entry: ShellCommand) => ({
    argv: entry.argv.map((word) => literal(word)),
    output: literal(entry.output ?? undefined),
    heredocs: entry.heredocs.map(({ content, expansions }) => ({ content, expansions })),
  }));
}

describe("parseShell", () => {
  test("captures a redirect target and the heredoc it writes", () => {
    expect(
      summarize("cat > body.md <<'EOF'\nProse.\nEOF\ngh pr create --body-file body.md"),
    ).toEqual([
      { argv: ["cat"], output: "body.md", heredocs: [{ content: "Prose.\n", expansions: [] }] },
      {
        argv: ["gh", "pr", "create", "--body-file", "body.md"],
        output: null,
        heredocs: [],
      },
    ]);
  });

  test("finds a redirect written after the heredoc operator", () => {
    expect(summarize("cat <<'EOF' > body.md\nProse.\nEOF")).toEqual([
      { argv: ["cat"], output: "body.md", heredocs: [{ content: "Prose.\n", expansions: [] }] },
    ]);
  });

  test("reports an unquoted heredoc's expansions", () => {
    expect(summarize("cat > body.md <<EOF\nRelease $VERSION\nEOF")).toEqual([
      {
        argv: ["cat"],
        output: "body.md",
        heredocs: [{ content: "Release $VERSION\n", expansions: ["$VERSION"] }],
      },
    ]);
  });

  test("strips tabs under <<- including the terminator's own indent", () => {
    expect(summarize("cat > body.md <<-'EOF'\n\tProse.\n\tEOF")).toEqual([
      { argv: ["cat"], output: "body.md", heredocs: [{ content: "Prose.\n", expansions: [] }] },
    ]);
  });

  // Neither leaves the file holding just this command's output, so neither is a
  // target the resolver may read a body back from.
  test.each<[string]>([["cat >> log.md <<'EOF'\nProse.\nEOF"], ["cat 2> err.md"]])(
    "reports no output target for %p",
    (command) => {
      expect(summarize(command)[0]?.output).toBeNull();
    },
  );

  test("keeps a << inside a quoted argument as data", () => {
    expect(summarize('echo "<<EOF"\ngh pr create --body-file body.md')).toEqual([
      { argv: ["echo", "<<EOF"], output: null, heredocs: [] },
      {
        argv: ["gh", "pr", "create", "--body-file", "body.md"],
        output: null,
        heredocs: [],
      },
    ]);
  });

  // A quoted argument is one word however many command-shaped phrases it holds,
  // which is what keeps a note or a log line from reading as an invocation.
  test("keeps a quoted command as one word", () => {
    expect(
      summarize(
        'bun url.ts add --notes "Blocked.\nRun gh pr edit 12 --body-file b.md\nThen push."',
      ),
    ).toEqual([
      {
        argv: [
          "bun",
          "url.ts",
          "add",
          "--notes",
          "Blocked.\nRun gh pr edit 12 --body-file b.md\nThen push.",
        ],
        output: null,
        heredocs: [],
      },
    ]);
  });

  test("reaches a command inside a subshell, pipeline, or brace group", () => {
    const commands = summarize("(cd /r && gh pr view 3 | tee out) ; { echo one; }");
    expect(commands.map((entry) => entry.argv)).toEqual([
      ["cd", "/r"],
      ["gh", "pr", "view", "3"],
      ["tee", "out"],
      ["echo", "one"],
    ]);
  });

  // `&&` and `||` bind equally and associate left, so `a || b && c` groups as
  // `(a || b) && c` and the last command runs down either branch.
  test.each<[string, boolean[]]>([
    ["cd a || cd b", [false, true]],
    ["cd a && cd b || cd c", [false, false, true]],
    ["cd a || cd b && cd c", [false, true, false]],
  ])("marks what %p reaches only after a failure", (command, expected) => {
    expect(parseShell(command).map((entry) => entry.fallback)).toEqual(expected);
  });

  // The redirect lands on the last stage while the content comes from the
  // first, so a caller following a file back to its source needs the grouping.
  test("gives the stages of one pipeline a shared identifier", () => {
    const commands = parseShell("gh pr view 3 --json body | jq -r .body > body.md\ncat body.md");
    expect(commands[0]?.pipeline).toBe(commands[1]?.pipeline);
    expect(commands[2]?.pipeline).not.toBe(commands[0]?.pipeline);
  });

  // A substitution is evaluated by the word that holds it, so its inner command
  // is not a step in the outer sequence.
  test("does not descend into a command substitution", () => {
    expect(summarize('glab mr create --description "$(cat body.md)"').map((e) => e.argv)).toEqual([
      ["glab", "mr", "create", "--description", null],
    ]);
  });

  test("resolves a variable from the environment and leaves an unset one alone", () => {
    expect(
      summarize("gh pr create --body-file $TMPDIR/b.md", { TMPDIR: "/scratch" })[0]?.argv,
    ).toEqual(["gh", "pr", "create", "--body-file", "/scratch/b.md"]);
    expect(summarize("gh pr create --body-file $NOPE/b.md")[0]?.argv).toEqual([
      "gh",
      "pr",
      "create",
      "--body-file",
      null,
    ]);
  });

  // A bare `NAME=value` statement is a real shell variable assignment, so it
  // reaches every statement after it in the same call.
  test("carries a bare assignment forward to a later statement", () => {
    expect(summarize('P=/scratch/b.md; gh pr create --body-file "$P"')[1]?.argv).toEqual([
      "gh",
      "pr",
      "create",
      "--body-file",
      "/scratch/b.md",
    ]);
  });

  test("does not carry an assignment prefixing a command into a later statement", () => {
    expect(
      summarize('P=/scratch/b.md gh pr view 1; gh pr create --body-file "$P"')[1]?.argv,
    ).toEqual(["gh", "pr", "create", "--body-file", null]);
  });

  test("leaves a name unresolved when its bare assignment cannot be evaluated", () => {
    expect(summarize('P=$(git rev-parse HEAD); gh pr create --body-file "$P"')[1]?.argv).toEqual([
      "gh",
      "pr",
      "create",
      "--body-file",
      null,
    ]);
  });

  // A subshell runs in a copy of the shell, so its assignments never reach a
  // sibling statement once it closes.
  test("does not carry a subshell's bare assignment past the subshell", () => {
    expect(summarize('(P=/scratch/x.md); gh pr create --body-file "$P"')[1]?.argv).toEqual([
      "gh",
      "pr",
      "create",
      "--body-file",
      null,
    ]);
  });

  test("resolves a heredoc's own byte span, distinct from the node's End()", () => {
    const command = "cat > body.md <<'EOF'\n## Heading\nProse.\nEOF\n";
    const heredoc = parseShell(command)[0]?.heredocs[0];
    expect(heredoc?.span).toBeDefined();
    const [start, end] = heredoc?.span ?? [0, 0];
    expect(command.slice(start, end)).toBe(heredoc?.content ?? "");
  });

  // The parser reports byte offsets, which run ahead of a JS string index once
  // a multi-byte character precedes the heredoc. The span has to land on the
  // string's own index, not the parser's byte count.
  test.each<[string, string]>([
    ["ascii prefix", "echo 'hello' > /dev/null\ncat > body.md <<'EOF'\nProse.\nEOF\n"],
    [
      "multi-byte prefix outside the heredoc",
      "echo '日本語' > /dev/null\ncat > body.md <<'EOF'\nProse.\nEOF\n",
    ],
    ["multi-byte prefix in the same statement", "cat > 日本語.md <<'EOF'\nProse.\nEOF\n"],
    [
      "astral (surrogate-pair) prefix",
      'gh pr create --title "🎉" --body-file - <<EOF\nProse.\nEOF\n',
    ],
  ])("keeps the heredoc span aligned with %s", (_label, command) => {
    const commands = parseShell(command);
    const heredoc = commands.at(-1)?.heredocs[0];
    const [start, end] = heredoc?.span ?? [0, 0];
    expect(command.slice(start, end)).toBe(heredoc?.content ?? "");
  });

  test("marks a <<- heredoc so its span cannot be spliced back verbatim", () => {
    const command = "cat > body.md <<-'EOF'\n\tProse.\n\tEOF";
    const heredoc = parseShell(command)[0]?.heredocs[0];
    expect(heredoc?.dash).toBe(true);
    const [start, end] = heredoc?.span ?? [0, 0];
    // The raw span still holds the tabs the stripped `content` lost.
    expect(command.slice(start, end)).not.toBe(heredoc?.content);
  });

  test("marks a plain heredoc as splice-safe", () => {
    const command = "cat > body.md <<'EOF'\nProse.\nEOF";
    expect(parseShell(command)[0]?.heredocs[0]?.dash).toBe(false);
  });

  test("does not write a bare assignment back into the caller's env object", () => {
    const env = { EXISTING: "1" };
    parseShell('P=set; gh pr create --body-file "$P"', env);
    expect(env).toEqual({ EXISTING: "1" });
  });

  // No shell would run it either, so there is nothing for a caller to act on.
  test.each<[string]>([["cat > body.md <<'EOF'\nUnterminated."], ["gh pr create 'unclosed"]])(
    "returns nothing for %p, which is not valid shell",
    (command) => {
      expect(parseShell(command)).toEqual([]);
    },
  );
});
