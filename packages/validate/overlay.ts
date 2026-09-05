import { join } from "node:path";
import { applyPatch, type Operation } from "rfc6902";
import { z } from "zod";
import { decode, decodeFile } from "../decode/index";

export const Schema = z.record(z.string(), z.unknown());
export type Schema = z.infer<typeof Schema>;

export const SchemaSource = z.looseObject({
  name: z.string(),
  url: z.string(),
  patch: z.string(),
});
export type SchemaSource = z.infer<typeof SchemaSource>;

const Sources = z.looseObject({ schemas: z.array(SchemaSource) });

const Patch = z.array(
  z.union([
    z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
    z.object({ op: z.literal("remove"), path: z.string() }),
    z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
    z.object({ op: z.literal("move"), from: z.string(), path: z.string() }),
    z.object({ op: z.literal("copy"), from: z.string(), path: z.string() }),
    z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
  ]),
) satisfies z.ZodType<Operation[]>;

/** A container a JSON Pointer token can index into. */
const Indexable = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

/**
 * Apply an RFC 6902 patch to a base schema, returning a new merged object.
 * The base is not mutated. Throws if any operation fails to apply.
 */
export function applyOverlay(base: Schema, patch: Operation[]): Schema {
  const merged = structuredClone(base);
  const results = applyPatch(merged, patch);
  const failures = results
    .map((result, index) => ({ result, index }))
    .filter((entry) => entry.result !== null);
  if (failures.length > 0) {
    const detail = failures
      .map(({ result, index }) => `  op[${index}]: ${result?.name}: ${result?.message}`)
      .join("\n");
    throw new Error(`overlay failed to apply:\n${detail}`);
  }
  return merged;
}

/**
 * Resolve a JSON Pointer (RFC 6901) against a value. Returns undefined when any
 * segment is missing, so it doubles as an existence check.
 */
// The value at a JSON Pointer depends on the runtime path string, so no
// caller-declarable shape exists.
// oxlint-disable-next-line local/no-unknown-returns
export function getPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: unknown = value;
  for (const token of tokens) {
    const container = Indexable.safeParse(current).data;
    if (!container) return undefined;
    current = Array.isArray(container) ? container[Number(token)] : container[token];
    if (current === undefined) return undefined;
  }
  return current;
}

/** How an overlay op relates to a base that already defines its target path. */
export type OverlayConflictKind = "absorbed" | "diverged";

export interface OverlayConflict {
  index: number;
  path: string;
  kind: OverlayConflictKind;
}

/**
 * Identify overlay operations whose target path the base already defines.
 *
 * `absorbed` is a base value deep-equal to the op's value, an edit upstream has
 * caught up on. `diverged` is an `add` whose value differs, which RFC 6902 `add`
 * silently replaces, so the overlay overwrites whatever upstream now ships. A
 * `replace` that changes an existing value is its intended use and is not
 * reported.
 */
export function findOverlayConflicts(base: Schema, patch: Operation[]): OverlayConflict[] {
  const conflicts: OverlayConflict[] = [];
  for (const [index, op] of patch.entries()) {
    if (op.op !== "add" && op.op !== "replace") continue;
    const existing = getPointer(base, op.path);
    if (existing === undefined) continue;
    if (Bun.deepEquals(existing, op.value)) {
      conflicts.push({ index, path: op.path, kind: "absorbed" });
    } else if (op.op === "add") {
      conflicts.push({ index, path: op.path, kind: "diverged" });
    }
  }
  return conflicts;
}

/** Read the overlay registry. The `patch` path in each entry is relative to schemasDir. */
export async function loadSources(schemasDir: string): Promise<SchemaSource[]> {
  const { schemas } = await decodeFile(Sources, join(schemasDir, "overlays/sources.json"));
  return schemas;
}

/** Read a source's overlay patch from disk. */
export async function loadPatch(schemasDir: string, source: SchemaSource): Promise<Operation[]> {
  return decodeFile(Patch, join(schemasDir, source.patch));
}

/** Fetch a source's upstream base schema from SchemaStore. */
export async function fetchBase(url: string): Promise<Schema> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} → ${response.status}`);
  return decode(Schema, await response.json(), url);
}

/**
 * Assemble an upstream-backed schema in memory: the upstream base fetched live
 * plus our overlay patch. Only the patch lives in the repo; nothing is vendored
 * or written to disk.
 */
export async function loadOverlaySchema(schemasDir: string, name: string): Promise<Schema> {
  const source = (await loadSources(schemasDir)).find((entry) => entry.name === name);
  if (!source) throw new Error(`unknown overlay schema "${name}"`);
  const [base, patch] = await Promise.all([fetchBase(source.url), loadPatch(schemasDir, source)]);
  return applyOverlay(base, patch);
}
