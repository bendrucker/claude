import { dirname, extname, join, normalize } from "node:path";
import { Lang, parse, type SgNode } from "@ast-grep/napi";
import { root } from "../assets";

export interface ModScan {
  /** Engine events the module subscribes to through `on(...)`. */
  events: string[];
  /** Components its `ui.render` hooks draw, plus the status, toast, and pane calls it makes. */
  surfaces: string[];
}

interface Accumulator {
  seen: Set<string>;
  events: Set<string>;
  surfaces: Set<string>;
}

const UI_CALLS: Record<string, string> = { status: "status", toast: "toast", open: "Pane" };

function literal(node: SgNode | null | undefined): string | undefined {
  if (node?.kind() !== "string") return undefined;
  return node.find({ rule: { kind: "string_fragment" } })?.text() ?? "";
}

function component(filter: SgNode | undefined): string | undefined {
  if (filter?.kind() !== "object") return undefined;
  for (const pair of filter.findAll({ rule: { kind: "pair" } })) {
    if (pair.field("key")?.text() === "component") return literal(pair.field("value"));
  }
  return undefined;
}

async function resolveImport(from: string, source: string): Promise<string | undefined> {
  const base = normalize(join(dirname(from), source));
  const candidates =
    extname(base) !== "" ? [base] : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  const found = await Promise.all(candidates.map((path) => Bun.file(join(root, path)).exists()));
  return candidates[found.indexOf(true)];
}

async function scanFile(path: string, acc: Accumulator): Promise<void> {
  if (acc.seen.has(path)) return;
  acc.seen.add(path);

  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return;
  const tree = parse(path.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript, await file.text()).root();

  for (const call of tree.findAll("on($EVENT, $$$ARGS)")) {
    const event = literal(call.getMatch("EVENT"));
    if (event === undefined) continue;
    acc.events.add(event);
    if (event === "ui.render") {
      const [filter] = call.getMultipleMatches("ARGS");
      acc.surfaces.add(component(filter) ?? "ui.render");
    }
  }

  for (const call of tree.findAll("$NS.ui.$METHOD($$$)")) {
    const surface = UI_CALLS[call.getMatch("METHOD")?.text() ?? ""];
    if (surface !== undefined) acc.surfaces.add(surface);
  }

  const relative = tree
    .findAll({ rule: { kind: "import_statement" } })
    .map((statement) => literal(statement.field("source")))
    .filter((source): source is string => source?.startsWith(".") === true);
  const resolved = await Promise.all(relative.map((source) => resolveImport(path, source)));
  await Promise.all(
    resolved.filter((next) => next !== undefined).map((next) => scanFile(next, acc)),
  );
}

/** Scans a mod's entry module and the relative imports it reaches. */
export async function scanMod(entry: string): Promise<ModScan> {
  const acc: Accumulator = { seen: new Set(), events: new Set(), surfaces: new Set() };
  await scanFile(entry, acc);
  return { events: [...acc.events].toSorted(), surfaces: [...acc.surfaces].toSorted() };
}
