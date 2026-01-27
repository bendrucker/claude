#!/usr/bin/env bun

import { cli } from "cleye";
import { parseDate } from "./date";
import { aggregateErrors, getErrors } from "./errors";
import {
  formatDigest,
  formatErrorAggregates,
  formatErrors,
  formatSearchResults,
  formatStats,
} from "./format";
import { getDigest, searchConversations } from "./query";
import { getStats } from "./stats";
import type { ErrorType, SearchOptions } from "./types";

type Mode = "search" | "digest" | "errors" | "stats";

interface ParsedArgs {
  mode: Mode;
  query: string;
  options: SearchOptions;
  format: "text" | "json";
  aggregate: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const argv = cli(
    {
      name: "search",
      parameters: ["[query]"],
      flags: {
        digest: {
          type: Boolean,
          description: "Show digest of recent conversations",
        },
        errors: {
          type: Boolean,
          description: "List tool errors from sessions",
        },
        stats: {
          type: Boolean,
          description: "Show usage statistics",
        },
        after: {
          type: String,
          description: "Only include conversations after this date",
        },
        before: {
          type: String,
          description: "Only include conversations before this date",
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
        aggregate: {
          type: Boolean,
          description: "For --errors: group by error message",
        },
        type: {
          type: String,
          description: "For --errors: filter by type (rejection or failure)",
        },
      },
      help: {
        description: "Search conversation history, get a digest, or analyze tool errors.",
        examples: [
          'search "fix error"              # Search for conversations',
          "search --digest --after today   # Today's digest",
          'search --errors --after "last week" --aggregate',
        ],
      },
    },
    args,
  );

  const mode: Mode = argv.flags.errors
    ? "errors"
    : argv.flags.stats
      ? "stats"
      : argv.flags.digest
        ? "digest"
        : "search";

  const options: SearchOptions = {};

  if (argv.flags.after) {
    options.after = parseDate(argv.flags.after);
  }
  if (argv.flags.before) {
    options.before = parseDate(argv.flags.before);
  }
  if (argv.flags.project) {
    options.project = argv.flags.project;
  }
  if (argv.flags.limit !== undefined) {
    if (argv.flags.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
    options.limit = argv.flags.limit;
  }
  if (argv.flags.type) {
    if (argv.flags.type !== "rejection" && argv.flags.type !== "failure") {
      throw new Error('--type must be "rejection" or "failure"');
    }
    options.errorType = argv.flags.type as ErrorType;
  }

  const format = argv.flags.format;
  if (format !== "text" && format !== "json") {
    throw new Error('--format must be "text" or "json"');
  }

  return {
    mode,
    query: argv._.query ?? "",
    options,
    format,
    aggregate: argv.flags.aggregate ?? false,
  };
}

function output<T>(data: T, format: "text" | "json", formatter: (data: T) => string): void {
  console.log(format === "json" ? JSON.stringify(data, null, 2) : formatter(data));
}

async function runDigest(args: ParsedArgs): Promise<void> {
  const conversations = await getDigest(args.options);
  output(conversations, args.format, formatDigest);
}

async function runErrors(args: ParsedArgs): Promise<void> {
  const options = args.aggregate ? { ...args.options, limit: undefined } : args.options;
  const errors = await getErrors(options);

  if (args.aggregate) {
    output(aggregateErrors(errors), args.format, formatErrorAggregates);
  } else {
    output(errors, args.format, formatErrors);
  }
}

async function runStats(args: ParsedArgs): Promise<void> {
  const stats = await getStats(args.options);
  output(stats, args.format, formatStats);
}

async function runSearch(args: ParsedArgs): Promise<void> {
  if (!args.query) {
    throw new Error("Search requires a query. Use --help for usage.");
  }
  const results = await searchConversations(args.query, args.options);
  output(results, args.format, formatSearchResults);
}

const modeHandlers: Record<Mode, (args: ParsedArgs) => Promise<void>> = {
  digest: runDigest,
  errors: runErrors,
  stats: runStats,
  search: runSearch,
};

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  await modeHandlers[parsed.mode](parsed);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
