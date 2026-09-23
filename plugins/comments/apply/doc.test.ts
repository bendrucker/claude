import { describe, expect, test } from "bun:test";
import { docCommentOf, goDocLead } from "../detection/doc";
import { extractComments } from "../detection/extract";
import type { Verdict } from "../judge/schema";
import { computeFileEdits, type EditItem } from "./edits";

/** Go shapes from a `--all` audit that deleted and flattened godoc. */
const source = `// Package command holds helpers shared by the resource CRUD commands: delete
// confirmation, definition-file intake, flag-override merging, and resolving a
// missing flag value through an interactive prompt.
package command

// EnumUsage renders allowed values for a flag's usage string, matching how
// ValidateEnum lists them when it rejects a value.
func EnumUsage(allowed []string) string {
	return strings.Join(allowed, ", ")
}

// knownMethod reports whether s is a recognized HTTP method, ignoring case.
func knownMethod(s string) bool {
	return false
}

// mergeBoard applies non-zero fields from src onto dst.
// Type is intentionally not merged because it is always "flexible".
func mergeBoard(dst *api.Board, src *api.Board) {}

// connectOptions carries everything the client factory needs to authenticate
// and open an MCP session. This is the OAuth path that options.AuthMCPOAuth
// names: it deliberately excludes the Honeycomb config API key, which the
// OAuth-protected MCP server does not accept, and reaches the server through the
// OAuth transport below rather than opts.Client / opts.ClientFor.
type connectOptions struct{}

// ConfirmDelete reports whether a delete should proceed. When yes is set it
// returns true without prompting. Otherwise it requires an interactive
// terminal, resolves a display name (calling fetchName only when a prompt is
// actually needed, so a --yes delete makes no extra API call), and prompts for
// y/N.
func ConfirmDelete(yes bool, fetchName func() (string, error)) (bool, error) {}
`;

function trim(trimTo?: string): Verdict {
  return {
    action: "trim",
    category: "docstring-scope",
    confidence: "high",
    rationale: "r",
    rewrite: null,
    ...(trimTo != null && { trimTo }),
  };
}

/** The verdict per comment, keyed by the identifier its doc comment opens with. */
const verdicts: Record<string, Verdict> = {
  Package: trim(),
  EnumUsage: trim(),
  knownMethod: trim(),
  mergeBoard: trim(`// Type is intentionally not merged because it is always "flexible".`),
  connectOptions: trim(
    "// connectOptions carries everything the client factory needs to authenticate and open an MCP session. This is the OAuth path that options.AuthMCPOAuth names: it deliberately excludes the Honeycomb config API key, which the OAuth-protected MCP server does not accept.",
  ),
  ConfirmDelete: trim(
    [
      "// ConfirmDelete reports whether a delete should proceed. It returns true",
      "// without prompting when yes is set, and calls fetchName only when a prompt",
      "// is needed, so a --yes delete makes no extra API call.",
    ].join("\n"),
  ),
};

async function editItems(): Promise<EditItem[]> {
  const lines = source.split("\n");
  const comments = await extractComments(source, "go");
  return comments.map((comment) => {
    const lead = /^\/\/ (\w+)/.exec(comment.text)?.[1] ?? "";
    const verdict = verdicts[lead];
    if (verdict == null) throw new Error(`no verdict for ${lead}`);
    const doc = docCommentOf(comment, lines, "go");
    return Object.assign(comment, { verdict, doc, lead: doc && goDocLead(doc) });
  });
}

describe("Go doc comments", () => {
  test("apply keeps required godoc, its lead, and its wrapping", async () => {
    const result = computeFileEdits(source, await editItems(), { language: "go" });
    expect(result.skips.map((skip) => `${skip.startLine}: ${skip.detail}`)).toMatchInlineSnapshot(`
      [
        "1: doc comment on command is required by the language's tooling; trim it to its lead sentence by hand",
        "6: doc comment on EnumUsage is required by the language's tooling; trim it to its lead sentence by hand",
        "17: replacement drops the doc comment's lead naming mergeBoard; keep the lead sentence",
        "21: replacement would produce a 267-character line (over 81, the comment's wrap width); re-wrap by hand",
      ]
    `);
    expect(result.content).not.toContain("knownMethod reports");
    expect(result.content).toContain(
      "// ConfirmDelete reports whether a delete should proceed. It returns true\n",
    );
    expect(result.content).not.toContain("prompts for\n// y/N.");
  });
});
