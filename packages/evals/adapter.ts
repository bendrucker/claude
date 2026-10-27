import { resolve } from "node:path";
import { z } from "zod";
import { native } from "./adapters/native";
import type { Loaded } from "./column";

/** Reads one framework's stored run into the shape `compare` pools. */
export interface Adapter {
  name: string;
  /** One result file or directory, as the user passes it on the command line. */
  read(path: string): Promise<Loaded>;
  /** The column label for a path when none is given, the path's basename by default. */
  label?: ((path: string) => string) | undefined;
}

const BUILT_IN: Record<string, Adapter> = { native };

const Shape = z.object({
  name: z.string(),
  read: z.custom<Adapter["read"]>((v) => typeof v === "function"),
  label: z.custom<NonNullable<Adapter["label"]>>((v) => typeof v === "function").optional(),
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
  if (!parsed.success)
    throw new Error(
      `${path} exports no adapter: its default or \`adapter\` export needs a name and a read function`,
    );
  return parsed.data;
}
