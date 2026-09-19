#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the review queue in the plugin data dir under ~/.claude/plugins
import { cli, command } from "cleye";
import { primaryRoot } from "./capture";
import {
  answerItem,
  BEN,
  clearItem,
  type Kind,
  openItems,
  type PushInput,
  pushItem,
  readQueue,
  resolveLanded,
} from "./items";
import { formatQueue } from "./status";
import { resolveDataDir } from "./threads";

const dataDir = {
  type: String,
  description: "Queue directory; defaults to the plugin data dir",
};

const by = {
  type: String,
  default: BEN,
  description: `Who cleared it, when it was not ${BEN} himself`,
};

// A raised item carries wherever it came from, so an answer can be delivered
// and the board can focus the pane that asked.
const origin = {
  url: { type: String, description: "What the item points at" },
  repo: { type: String, description: "Repository of the thread this came from" },
  branch: { type: String, description: "Branch of the thread this came from" },
  agent: { type: String, description: "herdr agent an answer goes back to" },
  pane: { type: String, description: "herdr pane the item came from" },
  dataDir,
};

interface OriginFlags {
  url?: string | undefined;
  repo?: string | undefined;
  branch?: string | undefined;
  agent?: string | undefined;
  pane?: string | undefined;
  dataDir?: string | undefined;
}

function fail(error: unknown): never {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function raise(kind: Kind, text: string, flags: OriginFlags): Promise<void> {
  const { repo, branch } = flags;
  if ((repo == null) !== (branch == null)) {
    process.stderr.write("--repo and --branch name a thread together\n");
    process.exit(2);
  }
  const input: PushInput = { kind, text, url: flags.url, agent: flags.agent, pane: flags.pane };
  if (repo != null && branch != null) input.thread = { repo: await primaryRoot(repo), branch };
  try {
    process.stdout.write(`${JSON.stringify(pushItem(input, resolveDataDir(flags.dataDir)))}\n`);
  } catch (error) {
    fail(error);
  }
}

const push = command(
  {
    name: "push",
    parameters: ["<text...>"],
    help: { description: "Raise something for Ben to look at." },
    flags: { review: { type: Boolean, description: "Raise it as a review (required)" }, ...origin },
  },
  async (argv) => {
    if (argv.flags.review !== true) {
      process.stderr.write("--review is required; use `ask` for a question\n");
      argv.showHelp();
      process.exit(2);
    }
    await raise("review", argv._.text.join(" "), argv.flags);
  },
);

const ask = command(
  {
    name: "ask",
    parameters: ["<text...>"],
    help: { description: "Ask Ben a decision only he can make." },
    flags: origin,
  },
  async (argv) => {
    await raise("question", argv._.text.join(" "), argv.flags);
  },
);

const ack = command(
  {
    name: "ack",
    parameters: ["<id>"],
    help: { description: "Clear an item Ben only had to see." },
    flags: { by, dataDir },
  },
  (argv) => {
    try {
      const item = clearItem(
        { id: argv._.id, state: "acked", by: argv.flags.by },
        resolveDataDir(argv.flags.dataDir),
      );
      process.stdout.write(`${JSON.stringify(item)}\n`);
    } catch (error) {
      fail(error);
    }
  },
);

const answer = command(
  {
    name: "answer",
    parameters: ["<id>", "<text...>"],
    help: { description: "Answer an item and send the answer to the agent that asked." },
    flags: { by, dataDir },
  },
  async (argv) => {
    try {
      const item = await answerItem(
        argv._.id,
        argv._.text.join(" "),
        argv.flags.by,
        resolveDataDir(argv.flags.dataDir),
      );
      process.stdout.write(`${JSON.stringify(item)}\n`);
    } catch (error) {
      fail(error);
    }
  },
);

const list = command(
  {
    name: "list",
    help: { description: "Print the items still waiting on Ben, oldest first." },
    flags: { json: { type: Boolean, description: "Print the items as JSON" }, dataDir },
  },
  async (argv) => {
    const dir = resolveDataDir(argv.flags.dataDir);
    const items = await resolveLanded(openItems(readQueue(dir)), dir);
    process.stdout.write(
      argv.flags.json ? `${JSON.stringify(items)}\n` : `${formatQueue(items, new Date())}\n`,
    );
  },
);

await cli(
  {
    name: "queue",
    help: { description: "Raise and clear the items that need Ben." },
    commands: [push, ask, ack, answer, list],
  },
  (argv) => {
    argv.showHelp();
    process.exit(2);
  },
);
