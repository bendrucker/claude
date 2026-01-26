#!/usr/bin/env tsx

import { parseDate } from "./search/date";
import { formatDigest, formatSearchResults } from "./search/format";
import { getDigest, searchConversations } from "./search/query";
import type { SearchOptions } from "./search/types";

function printUsage(): void {
  console.log(`Usage: search.ts [query] [options]

Search conversation history or get a digest of recent sessions.

Options:
  --digest         Show digest of recent conversations (no query needed)
  --after DATE     Only include conversations after this date
  --before DATE    Only include conversations before this date
  --project PATH   Filter by project path
  --limit N        Maximum results (default: 10 for search, 20 for digest)
  --format FORMAT  Output format: text (default) or json

Date formats:
  today, yesterday, this week, or ISO date (2024-01-15)

Examples:
  search.ts "fix error"              # Search for conversations about errors
  search.ts --digest today           # Today's conversation digest
  search.ts "auth" --after yesterday # Auth discussions since yesterday
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const options: SearchOptions = {};
  let query = "";
  let isDigest = false;
  let format = "text";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === "--digest") {
      isDigest = true;
      if (nextArg && !nextArg.startsWith("--")) {
        options.after = parseDate(nextArg);
        i++;
      }
    } else if (arg === "--after" && nextArg) {
      options.after = parseDate(nextArg);
      i++;
    } else if (arg === "--before" && nextArg) {
      options.before = parseDate(nextArg);
      i++;
    } else if (arg === "--project" && nextArg) {
      options.project = nextArg;
      i++;
    } else if (arg === "--limit" && nextArg) {
      const limit = parseInt(nextArg, 10);
      if (Number.isNaN(limit) || limit < 1) {
        throw new Error(`Invalid --limit: "${nextArg}". Must be a positive integer`);
      }
      options.limit = limit;
      i++;
    } else if (arg === "--format" && nextArg) {
      if (nextArg !== "text" && nextArg !== "json") {
        throw new Error(`Invalid --format: "${nextArg}". Must be "text" or "json"`);
      }
      format = nextArg;
      i++;
    } else if (arg && !arg.startsWith("--")) {
      query = arg;
    }
  }

  if (isDigest) {
    const conversations = await getDigest(options);
    if (format === "json") {
      console.log(JSON.stringify(conversations, null, 2));
    } else {
      console.log(formatDigest(conversations));
    }
  } else if (query) {
    const results = await searchConversations(query, options);
    if (format === "json") {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatSearchResults(results));
    }
  } else {
    printUsage();
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
