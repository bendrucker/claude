import { expect, test } from "bun:test";
import { dirname, join, relative, resolve } from "node:path";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..");
const ENTRY = join(import.meta.dirname, "stdio.ts");

const RELATIVE_IMPORT = /(?:from|import)\s+"(\.[^"]*)"/g;

/** Bun shell methods that read stdout instead of letting it through. */
const CAPTURES_STDOUT = /\.(quiet|text|json|blob|bytes|arrayBuffer|lines)\(/;

/** Prose mentioning `console.log` or a `$` shell call is not a write. */
function stripComment(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\/.*$/, "");
}

/**
 * Every module the server can reach. Only relative specifiers are followed:
 * a package can print all it likes as long as nothing on this path calls it,
 * and the modules that do print are all first-party.
 */
async function importClosure(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file == null || file === "" || seen.has(file)) continue;
    seen.add(file);

    // oxlint-disable-next-line no-await-in-loop -- breadth-first walk: the queue this loop drains is refilled from the file it just read.
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const specifier = match.at(1);
      if (specifier === undefined) continue;
      const target = resolve(dirname(file), specifier);
      // oxlint-disable-next-line no-await-in-loop -- breadth-first walk: the queue this loop drains is refilled from the file it just read.
      const path = (await Bun.file(`${target}.ts`).exists()) ? `${target}.ts` : target;
      if (path.endsWith(".ts")) queue.push(path);
    }
  }

  return [...seen].toSorted();
}

/**
 * stdout writes that a tool call can reach. A write below `import.meta.main`
 * belongs to the module's own CLI, which the server never enters.
 */
async function findStdoutWrites(): Promise<string[]> {
  const perFile = await Promise.all(
    (await importClosure(ENTRY)).map(async (file) => {
      const source = await Bun.file(file).text();
      const lines = source.split("\n");
      const cliStart = lines.findIndex((line) => line.includes("import.meta.main"));
      const reachable = cliStart === -1 ? lines : lines.slice(0, cliStart);
      const name = relative(PLUGIN_ROOT, file);
      const writes: string[] = [];

      // Identified by source text rather than line number, so an unrelated edit
      // above a write doesn't churn the snapshot.
      for (const raw of reachable) {
        const line = stripComment(raw);
        const code = line.trim();
        if (/\bconsole\.(log|info|debug|dir|table)\(/.test(line)) {
          writes.push(`${name}: ${code}`);
        }
        if (/\bprocess\.stdout\.write\(/.test(line)) {
          writes.push(`${name}: ${code}`);
        }
        // A Bun shell call inherits stdout unless something in the chain takes it.
        if (/\$`/.test(line) && !CAPTURES_STDOUT.test(line)) {
          writes.push(`${name}: ${code}`);
        }
      }
      return writes;
    }),
  );

  return perFile.flat();
}

// The snapshot is the point: stdout is the JSON-RPC channel, so a new write
// anywhere in the server's import closure has to be looked at by a human. The
// three below are `printCaptured`, which inbox.ts calls only from inside its own
// `import.meta.main` block.
test("stdout writes reachable from the server", async () => {
  expect(await findStdoutWrites()).toMatchInlineSnapshot(`
    [
      "scripts/inbox.ts: console.log(\`captured: \${title}\`);",
      "scripts/inbox.ts: console.log(\`captured: \${first}\${suffix}\`);",
      "scripts/inbox.ts: console.log("captured: (untitled)");",
    ]
  `);
});
