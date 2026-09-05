import { describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type BodyPart,
  type BodySpec,
  effectiveCwd,
  extractBodySpec,
  extractTitle,
  isPrBodyCommand,
  parseCommand,
  type ParsedCommand,
  resolveBody,
} from "./resolve-body";

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
    ["cat > notes.md <<'EOF'\nrun gh pr create --body-file x.md later\nEOF", false],
  ])("isPrBodyCommand(%p) -> %p", (command, expected) => {
    expect(isPrBodyCommand(command)).toBe(expected);
  });
});

describe("parseCommand", () => {
  test.each<[string, string, ParsedCommand]>([
    [
      "strips the body and captures a > redirect target",
      "cat > body.md <<'EOF'\nProse.\nEOF\ngh pr create --body-file body.md",
      {
        text: "cat > body.md <<'EOF'\ngh pr create --body-file body.md",
        heredocs: [
          {
            content: "Prose.\n",
            quoted: true,
            segment: "cat > body.md <<'EOF'",
            target: "body.md",
            offset: 14,
          },
        ],
      },
    ],
    [
      "finds a redirect written after the operator",
      "cat <<'EOF' > body.md\nProse.\nEOF",
      {
        text: "cat <<'EOF' > body.md",
        heredocs: [
          {
            content: "Prose.\n",
            quoted: true,
            segment: "cat <<'EOF' > body.md",
            target: "body.md",
            offset: 4,
          },
        ],
      },
    ],
    [
      "finds a tee sink and scopes the segment to its command",
      "mkdir -p tmp && tee tmp/body.md <<'EOF'\nProse.\nEOF",
      {
        text: "mkdir -p tmp && tee tmp/body.md <<'EOF'",
        heredocs: [
          {
            content: "Prose.\n",
            quoted: true,
            segment: " tee tmp/body.md <<'EOF'",
            target: "tmp/body.md",
            offset: 32,
          },
        ],
      },
    ],
    [
      "marks an unquoted delimiter and skips an append target",
      "cat >> log.md <<EOF\n$VERSION\nEOF",
      {
        text: "cat >> log.md <<EOF",
        heredocs: [
          {
            content: "$VERSION\n",
            quoted: false,
            segment: "cat >> log.md <<EOF",
            target: null,
            offset: 14,
          },
        ],
      },
    ],
    [
      "strips tabs under <<- and matches a tab-indented terminator",
      "cat > body.md <<-'EOF'\n\tProse.\n\tEOF",
      {
        text: "cat > body.md <<-'EOF'",
        heredocs: [
          {
            content: "Prose.\n",
            quoted: true,
            segment: "cat > body.md <<-'EOF'",
            target: "body.md",
            offset: 14,
          },
        ],
      },
    ],
    [
      "ignores a << inside a quoted argument",
      'echo "<<EOF"\ngh pr create --body-file body.md',
      { text: 'echo "<<EOF"\ngh pr create --body-file body.md', heredocs: [] },
    ],
    [
      "gives an unterminated heredoc the rest of the command",
      "cat > body.md <<'EOF'\nProse.\nMore prose.",
      {
        text: "cat > body.md <<'EOF'",
        heredocs: [
          {
            content: "Prose.\nMore prose.\n",
            quoted: true,
            segment: "cat > body.md <<'EOF'",
            target: "body.md",
            offset: 14,
          },
        ],
      },
    ],
  ])("%s", (_name, command, expected) => {
    expect(parseCommand(command)).toEqual(expected);
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
    [String.raw`gh pr create --body "a \"quoted\" word"`, parts(literal('a "quoted" word'))],
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
    // A heredoc that writes the body file in the same command is the body,
    // read before the file exists.
    [
      "mkdir -p tmp && cat > tmp/body.md <<'EOF'\n## Summary\n\nProse.\nEOF\ngh pr create --title T --body-file tmp/body.md",
      parts(literal("## Summary\n\nProse.\n")),
    ],
    [
      "cat <<'EOF' > body.md\nProse.\nEOF\ngh pr create --body-file ./body.md",
      parts(literal("Prose.\n")),
    ],
    [
      "tee body.md <<'EOF'\nProse.\nEOF\nglab mr create --description-file body.md",
      parts(literal("Prose.\n")),
    ],
    [
      "cat > body.md <<EOF\nPlain prose.\nEOF\ngh pr create --body-file body.md",
      parts(literal("Plain prose.\n")),
    ],
    [
      "cat > b.md <<'EOF'\nProse.\nEOF\nglab mr create --description \"$(cat b.md)\"",
      parts(literal("Prose.\n")),
    ],
    // A heredoc attached to the create command itself feeds its stdin.
    ["gh pr create --title T --body-file - <<'EOF'\nProse.\nEOF", parts(literal("Prose.\n"))],
    ["gh pr create --body-file /dev/stdin <<'EOF'\nProse.\nEOF", parts(literal("Prose.\n"))],
    // A write sequenced after the create command is not what the CLI reads.
    [
      "gh pr create --body-file body.md\ncat > body.md <<'EOF'\nProse.\nEOF",
      parts(file("body.md")),
    ],
    // A flag word inside another flag's quoted value is body text, not a flag.
    [
      'gh pr create --body "documents --body-file usage"',
      parts(literal("documents --body-file usage")),
    ],
    // Quoted `;` and `>` in the create command's own arguments do not detach
    // the stdin heredoc.
    [
      "gh pr create --title \"a; b\" --body-file - <<'EOF'\nProse.\nEOF",
      parts(literal("Prose.\n")),
    ],
    [
      "gh pr create --title \"a > b\" --body-file - <<'EOF'\nProse.\nEOF",
      parts(literal("Prose.\n")),
    ],
    // The shell feeds the last stdin redirection to the CLI.
    ["gh pr create --body-file - <<'A' <<'B'\nfirst\nA\nsecond\nB", parts(literal("second\n"))],
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
    ["gh pr create --body-file /dev/stdin", "standard input"],
    ["glab mr create --description -", "editor"],
    [
      "cat > body.md <<EOF\nRelease $VERSION\nEOF\ngh pr create --body-file body.md",
      "unquoted heredoc",
    ],
    ["gh pr create --body-file - <<EOF\nRelease $VERSION\nEOF", "$VERSION"],
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

const DOCUMENTED_FORMS: [string, string][] = (
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
    const command = snippet.replaceAll(/\S*\.md/g, bodyPath);
    expect(await resolveBody(command, REPO_ROOT)).toEqual({ kind: "text", text: body });
  });
});

describe("extractTitle", () => {
  test.each<[string, string | null]>([
    ['gh pr create --title "Add an LRU Cache"', "Add an LRU Cache"],
    ["gh pr create --title 'Add an LRU Cache'", "Add an LRU Cache"],
    ['gh pr create --title="Add an LRU Cache"', "Add an LRU Cache"],
    ["gh pr create -t 'Add an LRU Cache'", "Add an LRU Cache"],
    ["gh pr create --title cache", "cache"],
    [String.raw`gh pr create --title "a \"quoted\" word"`, 'a "quoted" word'],
    ['glab mr create --title "Add an LRU Cache" --description x', "Add an LRU Cache"],
    ["gh pr edit 12 --body-file body.md", null],
    ['BODY=$(mktemp -t pr) && gh pr create --title "Real Title" --body-file "$BODY"', "Real Title"],
    ['gh pr create --body "use tar -t archive.tar to list" --title "Real Title"', "Real Title"],
    ['gh pr edit 12 --body "documents the --title flag for the scaffolder"', null],
    [
      'cat > b.md <<\'EOF\'\ngh pr create --title "Fake Title"\nEOF\ngh pr create --title "Real Title" --body-file b.md',
      "Real Title",
    ],
  ])("extractTitle(%p) -> %p", (command, expected) => {
    expect(extractTitle(command)).toBe(expected);
  });
});

describe("effectiveCwd", () => {
  test.each<[string, string]>([
    ["gh pr create --body-file body.md", "/repo"],
    ["cd sub && gh pr create --body-file body.md", path.join("/repo", "sub")],
    ["cd /abs && gh pr create --body-file body.md", "/abs"],
    ["cd a && cd b && gh pr create --body-file body.md", path.join("/repo", "a", "b")],
    ["gh pr create --body-file body.md && cd sub", "/repo"],
    ['cd "$DIR" && gh pr create --body-file body.md', "/repo"],
    ["cd - && gh pr create --body-file body.md", "/repo"],
    // The || fallback only runs when the first cd failed.
    ["cd a || cd b && gh pr create --body-file body.md", path.join("/repo", "a")],
    // `~user` needs a passwd lookup the hook does not do.
    ["cd ~nobody && gh pr create --body-file body.md", "/repo"],
  ])("effectiveCwd(%p) -> %p", (command, expected) => {
    expect(effectiveCwd(command, "/repo")).toBe(expected);
  });
});
