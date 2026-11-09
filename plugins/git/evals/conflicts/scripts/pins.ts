#!/usr/bin/env bun
// Exits 1 when a lockfile case pins a dependency at its latest release, since a regenerated lockfile could not float off it.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Grader = z.object({ pattern: z.string().optional() });
const Latest = z.object({ version: z.string() });

export interface Pin {
  name: string;
  version: string;
  source: string;
}

const bunLockEntry = /"((?:@[^/"@]+\/)?[^/"@]+)@(\d+\.\d+\.\d+[^"]*)"/g;
const npmLockEntry = /"node_modules\/([^"]+)": \\\{\\s\*"version": "(\d+(?:\\\.\d+)+)"/g;

/** The `name@version` pins a grader pattern asserts, from a bun.lock key or a package-lock entry. */
export function extractPins(pattern: string, source: string): Pin[] {
  const bun = [...pattern.matchAll(bunLockEntry)].map(([, name = "", version = ""]) => ({
    name,
    version,
    source,
  }));
  const npm = [...pattern.matchAll(npmLockEntry)].map(([, name = "", version = ""]) => ({
    name,
    version: version.replaceAll(String.raw`\.`, "."),
    source,
  }));
  return [...bun, ...npm];
}

async function graderPins(path: string, source: string): Promise<Pin[]> {
  const [, frontmatter = ""] = (await Bun.file(path).text()).split(/^---$/m);
  const { pattern } = Grader.parse(Bun.YAML.parse(frontmatter));
  return pattern === undefined ? [] : extractPins(pattern, source);
}

async function casePins(suite: string): Promise<Pin[]> {
  const graders = readdirSync(suite, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("lockfile-"))
    .flatMap((entry) => {
      const dir = join(suite, entry.name, "graders");
      return readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => graderPins(join(dir, file), `${entry.name}/${file}`));
    });
  return (await Promise.all(graders)).flat();
}

async function latest(name: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`);
  if (!response.ok) throw new Error(`registry returned ${response.status} for ${name}`);
  return Latest.parse(await response.json()).version;
}

if (import.meta.main) {
  const pins = await casePins(join(import.meta.dirname, ".."));
  const current = await Promise.all(pins.map((pin) => latest(pin.name)));
  const stale = pins
    .filter((pin, index) => current[index] === pin.version)
    .map((pin) => `${pin.name}@${pin.version} is latest (${pin.source})`);
  if (stale.length > 0) {
    console.error(stale.join("\n"));
    process.exit(1);
  }
  console.log(`${pins.length} pins sit below their latest release`);
}
