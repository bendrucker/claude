import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Code } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { z } from "zod";

const Path = z.string();
const Operator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("json_parser"),
    parse_to: z.literal("body"),
    timestamp: z.object({ parse_from: Path, layout_type: z.literal("gotime"), layout: z.string() }),
    severity: z.object({ parse_from: Path }),
    scope_name: z.object({ parse_from: Path }),
  }),
  z.object({ type: z.literal("move"), from: Path, to: Path }),
  z.object({ type: z.literal("remove"), field: Path }),
]);
const Config = z.object({
  receivers: z.object({
    "filelog/mod_events": z.object({ include: z.array(z.string()), operators: z.array(Operator) }),
  }),
});

async function readBlocks(): Promise<Map<string, string>> {
  const readme = await Bun.file(join(import.meta.dirname, "README.md")).text();
  const blocks = new Map<string, string>();
  visit(fromMarkdown(readme), "code", (node: Code) => {
    if (node.lang !== null && node.lang !== undefined) blocks.set(node.lang, node.value);
  });
  return blocks;
}

async function readConfig() {
  const yaml = (await readBlocks()).get("yaml") ?? "";
  return Config.parse(Bun.YAML.parse(yaml)).receivers["filelog/mod_events"];
}

const Sample = z.object({
  timestamp: z.string(),
  severity_text: z.string(),
  severity_number: z.number(),
  event_name: z.string(),
  attributes: z.record(z.string(), z.json()),
  resource: z.record(z.string(), z.string()),
  scope: z.object({ name: z.string() }),
});

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Entry = Record<"body" | "attributes" | "resource", Json> & {
  timestamp?: Date;
  severity?: string;
  scope?: string;
};

/** Splits `body.a`, `attributes["event.name"]`, or `resource` into its root and keys. */
function keysOf(path: string): ["body" | "attributes" | "resource", string[]] {
  const [root, ...rest] = path.match(/[^.[\]"]+|\["[^"]+"\]/g) ?? [];
  const field = z.enum(["body", "attributes", "resource"]).parse(root);
  return [field, rest.map((key) => key.replaceAll(/^\["|"\]$/g, ""))];
}

const isMap = (value: Json | undefined): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function take(entry: Entry, path: string): Json {
  const [root, keys] = keysOf(path);
  if (keys.length === 0) {
    const value = entry[root];
    entry[root] = {};
    return value;
  }
  let parent: Json | undefined = entry[root];
  for (const key of keys.slice(0, -1)) parent = isMap(parent) ? parent[key] : undefined;
  if (!isMap(parent)) throw new Error(`${path} is missing`);
  const last = keys.at(-1) ?? "";
  if (!(last in parent)) throw new Error(`${path} is missing`);
  const value = parent[last] ?? null;
  delete parent[last];
  return value;
}

function put(entry: Entry, path: string, value: Json): void {
  const [root, keys] = keysOf(path);
  if (keys.length === 0) {
    entry[root] = value;
    return;
  }
  const target = entry[root];
  if (!isMap(target) || keys.length > 1) throw new Error(`cannot set ${path}`);
  target[keys[0] ?? ""] = value;
}

function peek(entry: Entry, path: string): Json | undefined {
  const [root, keys] = keysOf(path);
  let value: Json | undefined = entry[root];
  for (const key of keys) value = isMap(value) ? value[key] : undefined;
  return value;
}

/** Go reference-time tokens the layout uses, as patterns. */
const GOTIME: [string, string][] = [
  ["2006", String.raw`\d{4}`],
  ["Z07:00", String.raw`(?:Z|[+-]\d{2}:\d{2})`],
  [".000", String.raw`\.\d{3}`],
  ["01", String.raw`\d{2}`],
  ["02", String.raw`\d{2}`],
  ["15", String.raw`\d{2}`],
  ["04", String.raw`\d{2}`],
  ["05", String.raw`\d{2}`],
];

function layoutPattern(layout: string): RegExp {
  let pattern = layout;
  for (const [token, re] of GOTIME) pattern = pattern.replace(token, re);
  return new RegExp(`^${pattern}$`);
}

/** The severities stanza's default mapping parses. */
const SEVERITIES = new Set(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);

function run(operators: z.infer<typeof Operator>[], line: string): Entry {
  const entry: Entry = { body: line, attributes: {}, resource: {} };
  for (const op of operators) {
    if (op.type === "json_parser") {
      entry.body = z.json().parse(JSON.parse(line));
      const timestamp = z.string().parse(peek(entry, op.timestamp.parse_from));
      expect(timestamp).toMatch(layoutPattern(op.timestamp.layout));
      entry.timestamp = new Date(timestamp);
      entry.severity = z.string().parse(peek(entry, op.severity.parse_from));
      entry.scope = z.string().parse(peek(entry, op.scope_name.parse_from));
    } else if (op.type === "move") {
      put(entry, op.to, take(entry, op.from));
    } else {
      take(entry, op.field);
    }
  }
  return entry;
}

describe("README collector config", () => {
  test("maps the Format sample into an OTel log record", async () => {
    const config = await readConfig();
    const line = (await readBlocks()).get("json") ?? "";
    const sample = Sample.strict().parse(JSON.parse(line));

    const entry = run(config.operators, line);

    expect(entry).toEqual({
      body: {},
      timestamp: new Date(sample.timestamp),
      severity: sample.severity_text,
      scope: sample.scope.name,
      attributes: { ...sample.attributes, "event.name": sample.event_name },
      resource: sample.resource,
    });
    expect(SEVERITIES.has(sample.severity_text)).toBe(true);
    expect(sample.attributes).toHaveProperty(["session.id"]);
  });

  test("includes every chunk the writer names", async () => {
    const [include] = (await readConfig()).include;
    // oxlint-disable-next-line no-template-curly-in-string -- the collector's own env syntax.
    const prefix = "${env:HOME}/.claude/mod-events/";
    expect(include?.startsWith(prefix)).toBe(true);
    const glob = new Bun.Glob(include?.slice(prefix.length) ?? "");
    expect(glob.match("<session-id>/run-command.1791304406845.3.jsonl")).toBe(true);
  });
});
