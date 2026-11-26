#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { ensureThingsRunning } from "./ensure-running";
import { requireTags } from "../src/mcp/tags";
import { mergeTags, parseTags } from "./tags";
import { DEFAULT_LINK_BASE, dispatch, warnFallback } from "./url";

const INBOX_PARAMS = new Set(["title", "titles", "notes", "tags", "checklist-items"]);

/**
 * Wraps a value so a shell reads it as one literal argument. Single quotes stop
 * every other metacharacter, and an embedded single quote closes the run, escapes
 * itself, and reopens.
 *
 * Both values this quotes arrive as MCP tool arguments, so they are arbitrary
 * strings that end up in a snippet the user pastes into a shell.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Builds the resume footer for a captured todo. The caller supplies
 * `directory`, since the MCP server runs as a child of tailgate, whose cwd has
 * nothing to do with the session being attributed. A caller that doesn't know
 * the directory gets a snippet without the `cd`, which resumes from wherever
 * it's pasted.
 */
export function buildAttribution(sessionId: string, directory?: string): string {
  const resume = `claude --resume ${shellQuote(sessionId)}`;
  const command =
    directory != null && directory !== "" ? `cd ${shellQuote(directory)} && ${resume}` : resume;
  return `---\n\n🤖 Created via Claude Code (Session: ${sessionId})\n\n\`\`\`sh\n${command}\n\`\`\``;
}

export function printCaptured(params: Map<string, string>): void {
  const title = params.get("title");
  if (title != null && title !== "") {
    console.log(`captured: ${title}`);
    return;
  }
  const titles = params.get("titles");
  if (titles != null && titles !== "") {
    const lines = titles.split("\n").filter((line) => line.trim() !== "");
    const first = lines[0] ?? "(untitled)";
    const suffix = lines.length > 1 ? ` (+${lines.length - 1} more)` : "";
    console.log(`captured: ${first}${suffix}`);
    return;
  }
  console.log("captured: (untitled)");
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

// Reads `-s=abc` as `abc`, where commander alone would keep the `=` in a short flag's value.
function splitShortEquals(argv: string[]): string[] {
  const end = argv.includes("--") ? argv.indexOf("--") : argv.length;
  return [
    ...argv
      .slice(0, end)
      .flatMap((token) => (token.startsWith("-s=") ? ["-s", token.slice(3)] : [token])),
    ...argv.slice(end),
  ];
}

export const program = new Command("inbox")
  .argument("[params...]")
  .option("-s, --session-id <id>", "Claude session ID for attribution")
  .option(
    "--link-base <url>",
    "Prefix for the printed todo link, followed by the todo id",
    DEFAULT_LINK_BASE,
  )
  .option("--tag <tag>", "Extra tags to add (repeatable)", collect, [])
  .action(async (rawParams, flags) => {
    if (flags.sessionId == null || flags.sessionId === "") {
      console.error("--session-id is required for session attribution");
      process.exit(1);
    }

    const params = new Map<string, string>();

    for (const arg of rawParams) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex === -1) continue;
      const key = arg.slice(0, eqIndex);
      const value = arg.slice(eqIndex + 1);
      if (INBOX_PARAMS.has(key)) {
        params.set(key, value);
      }
    }

    const attribution = buildAttribution(flags.sessionId, process.cwd());
    const existing = params.get("notes");
    params.set(
      "notes",
      existing != null && existing !== "" ? `${existing}\n\n${attribution}` : attribution,
    );

    await ensureThingsRunning();

    try {
      // Things drops a tag it does not already know and still reports success, so
      // the CLI resolves against the stored tags for the same reason the tool does.
      const requested = mergeTags(["claude"], flags.tag, parseTags(params.get("tags")));
      params.set("tags", (await requireTags(requested, false)).join(","));

      const result = await dispatch("add", params);
      if (result.id != null && result.id !== "") {
        console.log(`${flags.linkBase}${result.id}`);
      } else {
        warnFallback(result);
        printCaptured(params);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

if (import.meta.main) {
  await program.parseAsync(splitShortEquals(process.argv.slice(2)), { from: "user" });
}
