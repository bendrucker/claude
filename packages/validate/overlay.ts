import { join } from "node:path";
import { applyPatch, type Operation } from "rfc6902";

export type Schema = Record<string, unknown>;

export interface SchemaSource {
  name: string;
  url: string;
  patch: string;
}

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
export function getPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = value;
  for (const token of tokens) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[token];
    if (current === undefined) return undefined;
  }
  return current;
}

export interface RedundantOp {
  index: number;
  path: string;
}

/**
 * Identify overlay operations the base already satisfies — an add/replace whose
 * target already deep-equals the operation's value. These are edits upstream has
 * absorbed and can be dropped from the patch without changing the merged schema.
 */
export function findRedundantOps(base: Schema, patch: Operation[]): RedundantOp[] {
  const redundant: RedundantOp[] = [];
  for (const [index, op] of patch.entries()) {
    if (op.op !== "add" && op.op !== "replace") continue;
    const existing = getPointer(base, op.path);
    if (existing !== undefined && Bun.deepEquals(existing, op.value)) {
      redundant.push({ index, path: op.path });
    }
  }
  return redundant;
}

/** Read the overlay registry. The `patch` path in each entry is relative to schemasDir. */
export async function loadSources(schemasDir: string): Promise<SchemaSource[]> {
  const { schemas } = (await Bun.file(join(schemasDir, "overlays/sources.json")).json()) as {
    schemas: SchemaSource[];
  };
  return schemas;
}

/** Read a source's overlay patch from disk. */
export async function loadPatch(schemasDir: string, source: SchemaSource): Promise<Operation[]> {
  return (await Bun.file(join(schemasDir, source.patch)).json()) as Operation[];
}

/** Fetch a source's upstream base schema from SchemaStore. */
export async function fetchBase(url: string): Promise<Schema> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} → ${response.status}`);
  return response.json() as Promise<Schema>;
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
