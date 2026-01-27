#!/usr/bin/env tsx

import arg from "arg";
import { parseDate } from "./search/date";
import { formatDigest, formatSearchResults, formatStats } from "./search/format";
import { getDigest, getStats, searchConversations } from "./search/query";
import type { SearchOptions } from "./search/types";

function printUsage(): void {
  console.log(`Usage: search.ts [query] [options]

Search conversation history or get a digest of recent sessions.

Options:
  --digest           Show digest of recent conversations (no query needed)
  --stats            Show aggregated statistics grouped by project
  --after DATE       Only include conversations after this date
  --before DATE      Only include conversations before this date
  --project PATH     Filter by project path
  --limit N          Maximum results (default: 10 for search, 20 for digest)
  --format FORMAT    Output format: text (default) or json

Date formats:
  today, yesterday, this week, or ISO date (2024-01-15)

Examples:
  search.ts "fix error"                  # Search for conversations about errors
  search.ts --digest                     # Recent conversation digest
  search.ts --digest --after today       # Today's conversations
  search.ts "auth" --after yesterday     # Auth discussions since yesterday
  search.ts --stats --after "last week"  # Stats by project for the week
`);
}

async function main(): Promise<void> {
  const args = arg(
    {
      "--digest": Boolean,
      "--stats": Boolean,
      "--after": String,
      "--before": String,
      "--project": String,
      "--limit": Number,
      "--format": String,
      "--help": Boolean,
      "-h": "--help",
    },
    { permissive: false },
  );

  if (args["--help"]) {
    printUsage();
    process.exit(0);
  }

  const format = args["--format"] ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error(`Invalid --format: "${format}". Must be "text" or "json"`);
  }

  const limit = args["--limit"];
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw new Error(`Invalid --limit: "${limit}". Must be a positive integer`);
  }

  const options: SearchOptions = {
    after: args["--after"] ? parseDate(args["--after"]) : undefined,
    before: args["--before"] ? parseDate(args["--before"]) : undefined,
    project: args["--project"],
    limit,
  };

  const query = args._[0];

  if (args["--stats"]) {
    const stats = await getStats(options);
    if (format === "json") {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(formatStats(stats));
    }
  } else if (args["--digest"]) {
    const result = await getDigest(options);
    if (format === "json") {
      console.log(JSON.stringify(result.conversations, null, 2));
    } else {
      console.log(formatDigest(result));
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
