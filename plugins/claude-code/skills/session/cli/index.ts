#!/usr/bin/env bun

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cli } from "cleye";
import { parseDate } from "./date";
import { type Database, ensureIndex, getDb, runQuery } from "./db";
import {
  formatDigest,
  formatErrorAggregates,
  formatErrors,
  formatSearchResults,
  formatStats,
} from "./format";
import type { DigestRow, ErrorAggregate, ErrorRow, SearchRow, StatsRow } from "./types";

const commonFlags = {
  after: {
    type: String,
    description: "Only include sessions after this date",
  },
  before: {
    type: String,
    description: "Only include sessions before this date",
  },
  project: {
    type: String,
    description: "Filter by project path",
  },
  limit: {
    type: Number,
    description: "Maximum results",
  },
  format: {
    type: String,
    description: "Output format: text or json",
    default: "text",
  },
} as const;

interface CommonFlags {
  after?: string | undefined;
  before?: string | undefined;
  project?: string | undefined;
  limit?: number | undefined;
  format?: string | undefined;
}

interface ParsedFlags {
  filters: Record<string, string | null>;
  limit: number;
  format: "text" | "json";
}

function parseCommonFlags(flags: CommonFlags): ParsedFlags {
  const filters = {
    after_date: flags.after ? parseDate(flags.after).toISOString() : null,
    before_date: flags.before ? parseDate(flags.before).toISOString() : null,
    project: flags.project ?? null,
  };

  if (flags.limit !== undefined && flags.limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  const format = flags.format ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error('--format must be "text" or "json"');
  }

  return { filters, limit: flags.limit ?? 20, format };
}

function output<T>(data: T, format: "text" | "json", formatter: (data: T) => string): void {
  console.log(format === "json" ? JSON.stringify(data, null, 2) : formatter(data));
}

function aggregateErrors(errors: ErrorRow[]): ErrorAggregate[] {
  const aggregates = new Map<string, { count: number; examples: ErrorRow[] }>();

  for (const error of errors) {
    const existing = aggregates.get(error.error_content);
    if (existing) {
      existing.count++;
      if (existing.examples.length < 3) {
        existing.examples.push(error);
      }
    } else {
      aggregates.set(error.error_content, { count: 1, examples: [error] });
    }
  }

  const results: ErrorAggregate[] = [];
  for (const [content, { count, examples }] of aggregates) {
    results.push({
      content,
      count,
      examples: examples.map((e) => ({
        tool_name: e.tool_name,
        session_id: e.session_id,
        project_path: e.project_path,
      })),
    });
  }

  results.sort((a, b) => b.count - a.count);
  return results;
}

async function runErrors(db: Database, args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "errors",
      flags: {
        ...commonFlags,
        type: {
          type: String,
          description: "Filter by type: rejection or failure",
        },
        aggregate: {
          type: Boolean,
          description: "Group by error message",
        },
      },
    },
    undefined,
    args,
  );

  const { filters, limit, format } = parseCommonFlags(argv.flags);

  let errorType: string | null = null;
  if (argv.flags.type) {
    if (argv.flags.type !== "rejection" && argv.flags.type !== "failure") {
      throw new Error('--type must be "rejection" or "failure"');
    }
    errorType = argv.flags.type;
  }

  if (argv.flags.aggregate && argv.flags.limit !== undefined) {
    throw new Error("--aggregate and --limit are mutually exclusive");
  }

  const errors = await runQuery<ErrorRow>(db, "errors", {
    ...filters,
    error_type: errorType,
    limit: String(argv.flags.aggregate ? 1000 : limit),
  });

  if (argv.flags.aggregate) {
    output(aggregateErrors(errors), format, formatErrorAggregates);
  } else {
    output(errors, format, formatErrors);
  }
}

async function runStats(db: Database, args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "stats",
      flags: commonFlags,
    },
    undefined,
    args,
  );

  const { filters, format } = parseCommonFlags(argv.flags);
  const rows = await runQuery<StatsRow>(db, "stats", filters);
  output(rows, format, formatStats);
}

async function runDigest(db: Database, args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "digest",
      flags: {
        ...commonFlags,
        session: {
          type: String,
          description: "Show a specific session by ID",
        },
      },
    },
    undefined,
    args,
  );

  const { filters, limit, format } = parseCommonFlags(argv.flags);

  const rows = await runQuery<DigestRow>(db, "digest", {
    ...filters,
    session_id: argv.flags.session ?? null,
    limit: String(limit),
  });

  if (argv.flags.session && rows.length === 0) {
    throw new Error(`Session not found: ${argv.flags.session}`);
  }

  output(rows, format, formatDigest);
}

async function runSearch(db: Database, args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "search",
      parameters: ["<query>"],
      flags: commonFlags,
    },
    undefined,
    args,
  );

  const { filters, limit, format } = parseCommonFlags(argv.flags);
  const rows = await runQuery<SearchRow>(db, "search", {
    ...filters,
    query: argv._.query,
    limit: String(limit),
  });
  output(rows, format, formatSearchResults);
}

function getDataDir(): string {
  const dir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "claude-session");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const subcommands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  search: runSearch,
  digest: runDigest,
  stats: runStats,
  errors: runErrors,
};

function showUsage(): void {
  console.log(`Usage: bun cli <command> [options]

Commands:
  search <query>   Search conversations by keyword
  digest           List recent sessions with summaries
  stats            Show tool usage statistics
  errors           List tool errors

Run 'bun cli <command> --help' for command-specific options.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    showUsage();
    return;
  }

  const handler = subcommands[subcommand];
  if (!handler) {
    console.error(`Unknown command: ${subcommand}\n`);
    showUsage();
    process.exit(1);
  }

  const db = await getDb(getDataDir());
  try {
    await ensureIndex(db);
    await handler(db, args.slice(1));
  } finally {
    db.close();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
