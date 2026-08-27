#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cli } from "cleye";
import { runCheck } from "./check";

const SNAPSHOT_DIR = join(
  import.meta.dirname,
  "..",
  "plugins",
  "review",
  "skills",
  "code",
  "references",
);

const argv = cli({
  name: "check-review-drift",
  flags: {
    binary: {
      type: String,
      description: "Path to the Claude Code executable. Defaults to resolving `claude` on PATH.",
    },
  },
});

const BUNDLE_MIN_BYTES = 100_000_000;

/**
 * The descriptor's own registration, so the gate probe reads code-review's flag
 * rather than any of the dozen other bundled skills that also set it.
 */
const DESCRIPTOR_ANCHOR = 'menuDescription:"Review the current diff for bugs and cleanups"';
const DESCRIPTOR_WINDOW = 400;

/** Orders semver descending. String sort puts 2.1.99 above 2.1.215. */
function bySemverDesc(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const diff = (y?.[i] ?? 0) - (x?.[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolves the Claude Code bundle: a Bun single-file executable well over
 * 100 MB. `claude` on PATH is sometimes a thin launcher script rather than the
 * bundle, so a small file there sends us to the installer's version store.
 */
async function findBinary(): Promise<string> {
  if (argv.flags.binary) return argv.flags.binary;

  const onPath = Bun.which("claude");
  if (onPath && Bun.file(onPath).size > BUNDLE_MIN_BYTES) return onPath;

  const versions = join(homedir(), ".local", "share", "claude", "versions");
  const entries = await readdir(versions).catch(() => []);
  for (const entry of entries.toSorted(bySemverDesc)) {
    const candidate = join(versions, entry, "claude");
    if (Bun.file(candidate).size > BUNDLE_MIN_BYTES) return candidate;
  }

  throw new Error("Could not locate the Claude Code executable. Pass --binary <path>.");
}

async function binaryVersion(binary: string): Promise<string> {
  const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  const version = out.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`Could not read a version from \`${binary} --version\`.`);
  return version;
}

async function snapshotVersions(): Promise<string[]> {
  const files = await readdir(SNAPSHOT_DIR);
  return files.flatMap((f) => f.match(/^upstream-(\d+\.\d+\.\d+)\.md$/)?.[1] ?? []);
}

/**
 * Pulls the verbatim prompt fragments out of the snapshot: the fenced blocks
 * under the "All finder angles, verbatim" section, which is where the angle
 * texts, the cleanup-precedence block, and the sweep gap focus live. Every one
 * of them must still appear byte-for-byte in the bundle.
 */
async function snapshotFragments(version: string): Promise<Map<string, string>> {
  const body = await Bun.file(join(SNAPSHOT_DIR, `upstream-${version}.md`)).text();
  const heading = body.match(/^## .*finder angles, verbatim.*$/m);
  if (!heading) {
    throw new Error(`upstream-${version}.md has no "finder angles, verbatim" section to compare.`);
  }
  const section = body.slice((heading.index as number) + heading[0].length);
  const fragments = new Map<string, string>();

  let label = "";
  let fence: string[] | undefined;
  for (const line of section.split("\n")) {
    if (line.startsWith("```")) {
      if (fence) {
        if (label && !fragments.has(label)) fragments.set(label, fence.join("\n").trim());
        fence = undefined;
      } else {
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    // Headings only count outside a fence: the angle texts themselves contain
    // `## Phase 0` lines that would otherwise end the section early.
    if (line.startsWith("### ")) label = line.slice(4).trim();
    else if (line.startsWith("## ")) break;
  }
  return fragments;
}

/**
 * Builds a matcher for one snapshot fragment. The bundle stores these texts as
 * minified JS template literals, so backticks and `${` arrive backslash-escaped
 * and non-ASCII characters arrive as `\uXXXX`. Fragments stored as ordinary
 * quoted strings instead carry `\n` for their line breaks. The pattern accepts
 * either form so a match still means the prompt text is byte-identical.
 */
function fragmentPattern(fragment: string): RegExp {
  const escaped = [...fragment]
    .map((char) => {
      const code = char.codePointAt(0) as number;
      if (code > 0x7f) {
        const utf8 = Buffer.from(char, "utf8")
          .toString("latin1")
          .replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
        return `(?:${utf8}|\\\\u${code.toString(16).padStart(4, "0")})`;
      }
      if (char === "\n") return "(?:\\n|\\\\n)";
      if (char === "`" || char === "$") return `\\\\?\\${char}`;
      return char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    })
    .join("");
  return new RegExp(escaped);
}

await runCheck(
  async () => {
    const binary = await findBinary();
    const version = await binaryVersion(binary);
    const snapshots = await snapshotVersions();

    if (snapshots.length === 0) {
      return {
        header: "No upstream snapshot found:",
        violations: [`expected upstream-<version>.md in ${SNAPSHOT_DIR}`],
      };
    }

    const bundle = Buffer.from(await Bun.file(binary).arrayBuffer()).toString("latin1");
    const violations: string[] = [];

    const anchor = bundle.indexOf(DESCRIPTOR_ANCHOR);
    const descriptor = anchor === -1 ? "" : bundle.slice(anchor, anchor + DESCRIPTOR_WINDOW);
    if (anchor === -1) {
      violations.push(
        "Could not find the code-review descriptor registration. Re-derive the anchor before trusting the rest of this check.",
      );
    } else if (!descriptor.includes("disableModelInvocation:!0")) {
      violations.push(
        "code-review no longer sets `disableModelInvocation`. The built-in is model-invocable again, so delete review:code and go back to it.",
      );
    }

    const snapshot = snapshots.includes(version)
      ? version
      : (snapshots.toSorted(bySemverDesc)[0] as string);
    if (snapshot !== version) {
      violations.push(
        `Installed Claude Code is ${version}; the newest snapshot is ${snapshot}. Re-extract and land references/upstream-${version}.md, then port any changes into SKILL.md, angles.md, and efforts.md.`,
      );
    }

    for (const [label, fragment] of await snapshotFragments(snapshot)) {
      if (!fragmentPattern(fragment).test(bundle)) {
        violations.push(
          `${label}: no longer present verbatim in ${version}. Decide whether to adopt the new text.`,
        );
      }
    }

    return {
      header: `Upstream code-review drift against Claude Code ${version} (${binary}):`,
      violations,
    };
  },
  { success: "review:code matches the upstream code-review prompt fragments" },
);
