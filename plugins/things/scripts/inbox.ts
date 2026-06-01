#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to Launch Services (open/xcall) for Things URL schemes

import { cli } from "cleye";
import { ensureThingsRunning } from "./ensure-running";
import { mergeTags, parseTags } from "./tags";
import { buildUrl, findXcallRunner, openUrl, xcall } from "./url";

const INBOX_PARAMS = new Set(["title", "titles", "notes", "tags", "checklist-items"]);

function buildAttribution(sessionId: string): string {
  const dir = process.cwd();
  return `---\n\n🤖 Created via Claude Code (Session: ${sessionId})\n\n\`\`\`sh\ncd ${dir} && claude --resume ${sessionId}\n\`\`\``;
}

function parseThingsId(xcallOutput: string): string | null {
  const match = xcallOutput.match(/x-things-id=([^&\s]+)/);
  return match?.[1] ?? null;
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

async function captureViaOpen(params: Map<string, string>): Promise<void> {
  try {
    await openUrl("add", params);
    printCaptured(params);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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

  if (await findXcallRunner()) {
    const url = await buildUrl("add", params);
    try {
      const result = await xcall(url);
      const id = parseThingsId(result);
      if (id) {
        console.log(`https://things.bendrucker.me/show?id=${id}`);
      } else {
        printCaptured(params);
      }
    } catch {
      await captureViaOpen(params);
    }
  } else {
    await captureViaOpen(params);
  }
}
