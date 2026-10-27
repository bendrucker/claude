import { resolve } from "node:path";
import { z } from "zod";
import { native } from "./adapters/native";
import type { Loaded } from "./column";
import type { Flip } from "./regrade";

export interface RunOptions {
  /** Git ref to read the artifact under test at, the working tree when absent. */
  ref?: string | undefined;
  /** Suffix for the stored result's name. */
  label?: string | undefined;
  /** Arguments passed through to the harness. */
  args: string[];
}

/** One run's session, as error analysis and call counts read it. */
export interface Transcript {
  reply?: string | undefined;
  /** Each tool call, as `<tool> <target>`. */
  calls: string[];
}

/** One framework's side of the climb loop: running a suite and reading back what it stored. */
export interface Adapter {
  name: string;
  /** Runs the suite with its artifact read at `ref`, and returns the stored result's path. */
  run(suite: string, options: RunOptions): Promise<string>;
  /** One stored result, as the user passes it on the command line. */
  read(path: string): Promise<Loaded>;
  /** Each case's tags, which carry the dev and holdout split. */
  tags(suite: string): Promise<Map<string, string[]>>;
  /** Re-scores a stored result under the suite's current graders, without new sessions. */
  rescore(suite: string, path: string): Promise<{ path: string; flips: Flip[] }>;
  /** Each `<case>/<arm>` cell's transcripts, one per run. */
  traces(path: string): Promise<Map<string, Transcript[]>>;
  /** The column label for a path when none is given, the path's basename by default. */
  label?: ((path: string) => string) | undefined;
}

const BUILT_IN: Record<string, Adapter> = { native };

const fn = <T>() => z.custom<T>((v) => typeof v === "function");

const Shape = z.object({
  name: z.string(),
  run: fn<Adapter["run"]>(),
  read: fn<Adapter["read"]>(),
  tags: fn<Adapter["tags"]>(),
  rescore: fn<Adapter["rescore"]>(),
  traces: fn<Adapter["traces"]>(),
  label: fn<NonNullable<Adapter["label"]>>().optional(),
});

/** A built-in adapter by name, or a module path whose default or `adapter` export is one. */
export async function resolveAdapter(spec: string | undefined): Promise<Adapter> {
  if (spec === undefined) return native;
  const built = BUILT_IN[spec];
  if (built !== undefined) return built;
  const path = resolve(spec);
  const mod: unknown = await import(path);
  const exports = z.object({ default: z.unknown(), adapter: z.unknown() }).partial().parse(mod);
  const parsed = Shape.safeParse(exports.default ?? exports.adapter);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`${path} exports no adapter, missing: ${missing}`);
  }
  return parsed.data;
}
