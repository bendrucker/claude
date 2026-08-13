#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript via ensure-running, which the command sandbox blocks

import { cli } from "cleye";
import { ensureThingsRunning } from "./ensure-running";
import { mergeTags, parseTags } from "./tags";
import { dispatch, warnFallback } from "./url";

const INBOX_PARAMS = new Set(["title", "titles", "notes", "tags", "checklist-items"]);

function buildAttribution(sessionId: string): string {
  const dir = process.cwd();
  return `---\n\n🤖 Created via Claude Code (Session: ${sessionId})\n\n\`\`\`sh\ncd ${dir} && claude --resume ${sessionId}\n\`\`\``;
}

export function printCaptured(params: Map<string, string>): void {
  const title = params.get("title");
  if (title) {
    console.log(`captured: ${title}`);
    return;
  }
  const titles = params.get("titles");
  if (titles) {
    const lines = titles.split("\n").filter((line) => line.trim());
    const first = lines[0] ?? "(untitled)";
    const suffix = lines.length > 1 ? ` (+${lines.length - 1} more)` : "";
    console.log(`captured: ${first}${suffix}`);
    return;
  }
  console.log("captured: (untitled)");
}

if (import.meta.main) {
  const argv = cli({
    name: "inbox",
    parameters: ["[params...]"],
    flags: {
      sessionId: {
        type: String,
        description: "Claude session ID for attribution",
        alias: "s",
      },
      tag: {
        type: [String],
        description: "Extra tags to add (repeatable)",
      },
    },
  });

  if (!argv.flags.sessionId) {
    console.error("--session-id is required for session attribution");
    process.exit(1);
  }

  const params = new Map<string, string>();

  for (const arg of argv._.params) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;
    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);
    if (INBOX_PARAMS.has(key)) {
      params.set(key, value);
    }
  }

  const tags = mergeTags(["Claude"], argv.flags.tag ?? [], parseTags(params.get("tags")));
  params.set("tags", tags.join(","));

  const attribution = buildAttribution(argv.flags.sessionId);
  const existing = params.get("notes");
  params.set("notes", existing ? `${existing}\n\n${attribution}` : attribution);

  await ensureThingsRunning();

  try {
    const result = await dispatch("add", params);
    if (result.id) {
      console.log(`https://things.bendrucker.me/show?id=${result.id}`);
    } else {
      warnFallback(result);
      printCaptured(params);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
