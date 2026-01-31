#!/usr/bin/env bun

import { cli } from "cleye";
import { parseDate } from "./date";
import { createDebugContext, type DebugContext, printTimingSummary } from "./debug";
import { aggregateErrors, getErrors, type ToolError } from "./errors";
import {
  formatDigest,
  formatErrorAggregates,
  formatErrors,
  formatSearchResults,
  formatStats,
} from "./format";
import { getDigest, getSession, searchConversations } from "./query";
import { getStats, type ToolStats } from "./stats";
import type { ErrorType, SearchOptions } from "./types";

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
  debug: {
    type: Boolean,
    description: "Enable debug output to stderr",
    default: false,
  },
} as const;

function parseCommonOptions(flags: {
  after?: string | undefined;
  before?: string | undefined;
  project?: string | undefined;
  limit?: number | undefined;
  format?: string | undefined;
  debug?: boolean | undefined;
}): { options: SearchOptions; format: "text" | "json"; ctx: DebugContext } {
  const ctx = createDebugContext(flags.debug ?? false);
  const options: SearchOptions = { ctx };

  if (flags.after) {
    options.after = parseDate(flags.after);
  }
  if (flags.before) {
    options.before = parseDate(flags.before);
  }
  if (flags.project) {
    options.project = flags.project;
  }
  if (flags.limit !== undefined) {
    if (flags.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
    options.limit = flags.limit;
  }

  const format = flags.format ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error('--format must be "text" or "json"');
  }

  return { options, format, ctx };
}

function output<T>(data: T, format: "text" | "json", formatter: (data: T) => string): void {
  console.log(format === "json" ? JSON.stringify(data, null, 2) : formatter(data));
}

function validateOrder(order: string | undefined): "asc" | "desc" {
  const value = order ?? "desc";
  if (value !== "asc" && value !== "desc") {
    throw new Error('--order must be "asc" or "desc"');
  }
  return value;
}

async function runErrors(args: string[]): Promise<void> {
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
        sort: {
          type: String,
          description: "Sort by: timestamp (default) or tool",
          default: "timestamp",
        },
        order: {
          type: String,
          description: "Sort order: asc or desc (default)",
          default: "desc",
        },
      },
    },
    undefined,
    args,
  );

  const { options, format, ctx } = parseCommonOptions(argv.flags);

  if (argv.flags.type) {
    if (argv.flags.type !== "rejection" && argv.flags.type !== "failure") {
      throw new Error('--type must be "rejection" or "failure"');
    }
    options.errorType = argv.flags.type as ErrorType;
  }

  if (argv.flags.aggregate && options.limit !== undefined) {
    throw new Error("--aggregate and --limit are mutually exclusive");
  }

  let errors = await getErrors(options);

  const sort = argv.flags.sort;
  if (sort !== "timestamp" && sort !== "tool") {
    throw new Error('--sort must be "timestamp" or "tool"');
  }

  const order = validateOrder(argv.flags.order);

  const comparators: Record<string, (a: ToolError, b: ToolError) => number> = {
    timestamp: (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
    tool: (a, b) => a.toolName.localeCompare(b.toolName),
  };

  errors = errors.sort(comparators[sort]);
  if (order === "desc") {
    errors = errors.reverse();
  }

  if (argv.flags.aggregate) {
    output(aggregateErrors(errors), format, formatErrorAggregates);
  } else {
    output(errors, format, formatErrors);
  }
  printTimingSummary(ctx);
}

async function runStats(args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "stats",
      flags: {
        ...commonFlags,
        sort: {
          type: String,
          description: "Sort by: uses (default), errors, or rate",
          default: "uses",
        },
        order: {
          type: String,
          description: "Sort order: asc or desc (default)",
          default: "desc",
        },
      },
    },
    undefined,
    args,
  );

  const { options, format, ctx } = parseCommonOptions(argv.flags);

  const stats = await getStats(options);

  const sort = argv.flags.sort;
  if (sort !== "uses" && sort !== "errors" && sort !== "rate") {
    throw new Error('--sort must be "uses", "errors", or "rate"');
  }

  const order = validateOrder(argv.flags.order);

  const comparators: Record<string, (a: ToolStats, b: ToolStats) => number> = {
    uses: (a, b) => a.uses - b.uses,
    errors: (a, b) => a.errors - b.errors,
    rate: (a, b) => a.errorRate - b.errorRate,
  };

  stats.tools.sort(comparators[sort]);
  if (order === "desc") {
    stats.tools.reverse();
  }

  output(stats, format, formatStats);
  printTimingSummary(ctx);
}

async function runDigest(args: string[]): Promise<void> {
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

  const { options, format, ctx } = parseCommonOptions(argv.flags);

  if (argv.flags.session) {
    const conversation = await getSession(argv.flags.session, options);
    if (!conversation) {
      throw new Error(`Session not found: ${argv.flags.session}`);
    }
    const result = { conversations: [conversation], totalCount: 1, truncated: false };
    output(result, format, formatDigest);
    printTimingSummary(ctx);
    return;
  }

  const result = await getDigest(options);
  output(result, format, formatDigest);
  printTimingSummary(ctx);
}

async function runSearch(args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "search",
      parameters: ["<query>"],
      flags: commonFlags,
    },
    undefined,
    args,
  );

  const { options, format, ctx } = parseCommonOptions(argv.flags);
  const results = await searchConversations(argv._.query, options);
  output(results, format, formatSearchResults);
  printTimingSummary(ctx);
}

const subcommands: Record<string, (args: string[]) => Promise<void>> = {
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

  await handler(args.slice(1));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
