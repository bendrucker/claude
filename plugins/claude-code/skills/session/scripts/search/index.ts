#!/usr/bin/env bun

import { cli } from "cleye";
import { parseDate } from "./date";
import { aggregateErrors, getErrors, type ToolError } from "./errors";
import {
  formatDigest,
  formatErrorAggregates,
  formatErrors,
  formatSearchResults,
  formatStats,
} from "./format";
import { getDigest, searchConversations } from "./query";
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
} as const;

function parseCommonOptions(flags: {
  after?: string;
  before?: string;
  project?: string;
  limit?: number;
  format?: string;
}): { options: SearchOptions; format: "text" | "json" } {
  const options: SearchOptions = {};

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

  return { options, format };
}

function output<T>(data: T, format: "text" | "json", formatter: (data: T) => string): void {
  console.log(format === "json" ? JSON.stringify(data, null, 2) : formatter(data));
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
    args,
  );

  const { options, format } = parseCommonOptions(argv.flags);

  if (argv.flags.type) {
    if (argv.flags.type !== "rejection" && argv.flags.type !== "failure") {
      throw new Error('--type must be "rejection" or "failure"');
    }
    options.errorType = argv.flags.type as ErrorType;
  }

  const fetchOptions = argv.flags.aggregate ? { ...options, limit: undefined } : options;
  let errors = await getErrors(fetchOptions);

  const sort = argv.flags.sort;
  if (sort !== "timestamp" && sort !== "tool") {
    throw new Error('--sort must be "timestamp" or "tool"');
  }

  const order = argv.flags.order;
  if (order !== "asc" && order !== "desc") {
    throw new Error('--order must be "asc" or "desc"');
  }

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
    args,
  );

  const { options, format } = parseCommonOptions(argv.flags);

  const stats = await getStats(options);

  const sort = argv.flags.sort;
  if (sort !== "uses" && sort !== "errors" && sort !== "rate") {
    throw new Error('--sort must be "uses", "errors", or "rate"');
  }

  const order = argv.flags.order;
  if (order !== "asc" && order !== "desc") {
    throw new Error('--order must be "asc" or "desc"');
  }

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
}

async function runDigest(args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "digest",
      flags: commonFlags,
    },
    args,
  );

  const { options, format } = parseCommonOptions(argv.flags);
  const result = await getDigest(options);
  output(result, format, formatDigest);
}

async function runSearch(args: string[]): Promise<void> {
  const argv = cli(
    {
      name: "search",
      parameters: ["<query>"],
      flags: commonFlags,
    },
    args,
  );

  const { options, format } = parseCommonOptions(argv.flags);
  const results = await searchConversations(argv._.query, options);
  output(results, format, formatSearchResults);
}

const subcommands: Record<string, (args: string[]) => Promise<void>> = {
  errors: runErrors,
  stats: runStats,
  digest: runDigest,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (subcommand && subcommand in subcommands) {
    await subcommands[subcommand](args.slice(1));
  } else {
    await runSearch(args);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
