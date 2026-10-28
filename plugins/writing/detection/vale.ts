import { dirname, extname, join } from "node:path";
import { z } from "zod";
import aliases from "./category-aliases.json" with { type: "json" };
import type { PatternTier } from "./tropes";

export const VALE_CONFIG = join(import.meta.dirname, "..", ".vale.ini");

export type ValeSeverity = "error" | "warning" | "suggestion";

/** Where text came from, which picks the `.vale.ini` section that lints it. */
export type ValeSource = { filePath: string } | { kind: "body" | "commit" };

const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Severity: z.enum(["error", "warning", "suggestion"]),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
});
const Output = z.record(z.string(), z.array(Alert));

export type ValeAlert = z.infer<typeof Alert>;

/** Old TS categories whose Vale replacement has landed, keyed old name to Vale check. */
export const CATEGORY_ALIASES: Readonly<Record<string, string>> = aliases;

const RETIRED_CATEGORIES: ReadonlySet<string> = new Set([
  "honest qualifier",
  "backtick path bullet",
  "tricolon",
]);

export function isPorted(category: string): boolean {
  return Object.hasOwn(CATEGORY_ALIASES, category) || RETIRED_CATEGORIES.has(category);
}

export function tierOfSeverity(severity: ValeSeverity): PatternTier | undefined {
  if (severity === "error") return "deny";
  if (severity === "warning") return "context";
  return undefined;
}

export function valeBinary(): string | null {
  const onPath = Bun.which("vale");
  if (onPath !== null) return onPath;
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (data === undefined || data === "") return null;
  const bundled = join(data, "bin", "vale");
  return Bun.which(bundled) ?? null;
}

function extensionOf(source: ValeSource): string {
  if ("kind" in source) return source.kind === "commit" ? ".commitmsg" : ".prbody";
  const ext = extname(source.filePath);
  return ext === "" ? ".prbody" : ext;
}

/** The directory of the nearest `.vale.ini` or `_vale.ini` above `filePath`, if a repo adopted Vale. */
export async function repoConfigRoot(filePath: string): Promise<string | null> {
  const ancestors: string[] = [];
  for (let dir = dirname(filePath); ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dirname(dir) === dir) break;
  }
  const adopted = await Promise.all(
    ancestors.map(async (dir) =>
      (
        await Promise.all(
          [".vale.ini", "_vale.ini"].map((name) => Bun.file(join(dir, name)).exists()),
        )
      ).some(Boolean),
    ),
  );
  return ancestors[adopted.indexOf(true)] ?? null;
}

// A repo's own config replaces the plugin's, since Vale merges only the global
// config with one other. Tests skip the global config so they see only the plugin's styles.
async function configArgs(source: ValeSource): Promise<{ args: string[]; cwd?: string }> {
  const root = "filePath" in source ? await repoConfigRoot(source.filePath) : null;
  const args = root === null ? [`--config=${VALE_CONFIG}`] : [];
  if (process.env.NODE_ENV === "test") args.push("--no-global");
  return root === null ? { args } : { args, cwd: root };
}

/** Lint `text` with the plugin's Vale config. Returns [] when vale is unavailable, or on a runtime failure unless `strict`. */
export async function valeAlerts(
  text: string,
  source: ValeSource,
  { strict = false }: { strict?: boolean } = {},
): Promise<ValeAlert[]> {
  if (text.trim() === "") return [];
  const binary = valeBinary();
  if (binary === null) return [];
  const { args, ...cwd } = await configArgs(source);
  const proc = Bun.spawn([binary, ...args, "--output=JSON", `--ext=${extensionOf(source)}`], {
    ...cwd,
    stdin: new Blob([text]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1 && strict) throw new Error(`vale exited ${exitCode}: ${stderr.trim()}`);
  if (exitCode > 1 || stdout.trim() === "") return [];
  return Object.values(Output.parse(JSON.parse(stdout))).flat();
}
