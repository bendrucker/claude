#!/usr/bin/env bun

import { cli } from "cleye";
import { mergeTags, parseTags } from "./tags";
import { buildUrl, findXcallRunner, openUrl, xcall } from "./url";

const INBOX_PARAMS = new Set(["title", "titles", "notes", "tags", "checklist-items"]);

const argv = cli({
  name: "inbox",
  parameters: ["[params...]"],
  flags: {
    sessionId: {
      type: String,
      description: "Claude session ID for attribution",
      alias: "s",
    },
  },
});

function buildAttribution(sessionId: string): string {
  const dir = process.cwd();
  return `---\n\n🤖 Created via Claude Code (Session: ${sessionId})\n\n\`\`\`sh\ncd ${dir} && claude --resume ${sessionId}\n\`\`\``;
}

function parseThingsId(xcallOutput: string): string | null {
  const match = xcallOutput.match(/x-things-id=([^&\s]+)/);
  return match?.[1] ?? null;
}

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

const tags = mergeTags(
  ["Claude"],
  parseTags(process.env.THINGS_EXTRA_TAGS),
  parseTags(params.get("tags")),
);
params.set("tags", tags.join(","));

const attribution = buildAttribution(argv.flags.sessionId);
const existing = params.get("notes");
params.set("notes", existing ? `${existing}\n\n${attribution}` : attribution);

if (findXcallRunner()) {
  const url = await buildUrl("add", params);
  try {
    const result = await xcall(url);
    const id = parseThingsId(result);
    if (id) {
      console.log(`https://things.bendrucker.me/show?id=${id}`);
    }
  } catch {
    await openUrl("add", params);
  }
} else {
  await openUrl("add", params);
}
