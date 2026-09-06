import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { excludeAddition, link, overlayRoot, overlayStatus, parseRemoteUrl } from "./link";

const KEY = "raycast/extensions";

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

interface Fixture {
  checkout: string;
  overlay: string;
  root: string;
}

async function fixture(options: { overlay?: boolean } = {}): Promise<Fixture> {
  const base = mkdtempSync(join(tmpdir(), "overlay-"));
  const checkout = join(base, "checkout");
  const root = join(base, "overlays");
  const overlay = join(root, KEY, ".claude");

  await mkdir(checkout, { recursive: true });
  await git(checkout, ["init", "--initial-branch=main"]);
  await git(checkout, ["remote", "add", "upstream", `git@github.com:${KEY}.git`]);
  if (options.overlay !== false) await mkdir(overlay, { recursive: true });

  return { checkout, overlay, root };
}

function excludePath(checkout: string): string {
  return join(checkout, ".git", "info", "exclude");
}

async function excludes(checkout: string): Promise<boolean> {
  const file = Bun.file(excludePath(checkout));
  if (!(await file.exists())) return false;
  return (await file.text()).split("\n").includes("/.claude");
}

describe("parseRemoteUrl", () => {
  test.each([
    ["git@github.com:raycast/extensions.git", KEY],
    ["https://github.com/raycast/extensions.git", KEY],
    ["https://github.com/raycast/extensions", KEY],
    ["ssh://git@github.com/raycast/extensions", KEY],
    ["ssh://git@github.com/raycast/extensions.git", KEY],
    ["https://gitlab.com/group/subgroup/service.git", "group/subgroup/service"],
    ["/Users/ben/src/local-mirror", null],
    ["git@github.com:extensions.git", null],
    ["", null],
  ])("%s parses to %p", (url, key) => {
    expect(parseRemoteUrl(url)).toBe(key);
  });
});

describe("overlayRoot", () => {
  test("prefers the configured root", () => {
    expect(overlayRoot({ CLAUDE_OVERLAYS_ROOT: "/somewhere/overlays", HOME: "/home/ben" })).toBe(
      "/somewhere/overlays",
    );
  });

  test("falls back to the deployed clone", () => {
    expect(overlayRoot({ HOME: "/home/ben" })).toBe("/home/ben/.claude-repo/overlays");
  });

  test("ignores an empty configured root", () => {
    expect(overlayRoot({ CLAUDE_OVERLAYS_ROOT: "", HOME: "/home/ben" })).toBe(
      "/home/ben/.claude-repo/overlays",
    );
  });
});

describe("excludeAddition", () => {
  test.each([
    ["", "/.claude\n"],
    ["node_modules\n", "/.claude\n"],
    ["node_modules", "\n/.claude\n"],
  ])("appends to %p", (contents, addition) => {
    expect(excludeAddition(contents)).toBe(addition);
  });

  test.each(["/.claude\n", "node_modules\n/.claude\n", "  /.claude  \n"])(
    "leaves %p alone",
    (contents) => {
      expect(excludeAddition(contents)).toBeNull();
    },
  );
});

describe("link", () => {
  test("links a checkout with no .claude", async () => {
    const { checkout, overlay, root } = await fixture();

    expect(await link(checkout, root)).toEqual({
      status: "linked",
      key: KEY,
      moved: [],
      kept: [],
    });
    expect(await readlink(join(checkout, ".claude"))).toBe(overlay);
    expect(await Bun.file(excludePath(checkout)).text()).toContain("/.claude\n");
  });

  test("leaves an existing link alone", async () => {
    const { checkout, overlay, root } = await fixture();
    await symlink(overlay, join(checkout, ".claude"));

    expect(await link(checkout, root)).toEqual({ status: "already-linked", key: KEY });
    expect(await readlink(join(checkout, ".claude"))).toBe(overlay);
  });

  test("adopts a .claude holding only gitignored state", async () => {
    const { checkout, overlay, root } = await fixture();
    const claude = join(checkout, ".claude");
    await mkdir(join(claude, ".cc-writes"), { recursive: true });
    await Bun.write(join(claude, "settings.local.json"), "{}\n");
    await Bun.write(join(overlay, "settings.local.json"), '{"kept": true}\n');

    const outcome = await link(checkout, root);

    expect(outcome).toEqual({
      status: "linked",
      key: KEY,
      moved: [".cc-writes"],
      kept: ["settings.local.json"],
    });
    expect(await readlink(claude)).toBe(overlay);
    expect((await readdir(overlay)).toSorted()).toEqual([".cc-writes", "settings.local.json"]);
    expect(await Bun.file(join(overlay, "settings.local.json")).text()).toBe('{"kept": true}\n');
  });

  test("refuses a .claude holding anything else", async () => {
    const { checkout, root } = await fixture();
    const claude = join(checkout, ".claude");
    await mkdir(claude, { recursive: true });
    await Bun.write(join(claude, "settings.json"), "{}\n");

    expect(await link(checkout, root)).toEqual({
      status: "blocked",
      key: KEY,
      reason: "it holds settings.json",
    });
    expect(await excludes(checkout)).toBe(false);
  });

  test("does nothing without an overlay for the remote", async () => {
    const { checkout, root } = await fixture({ overlay: false });

    expect(await link(checkout, root)).toEqual({ status: "no-overlay", key: KEY });
    expect(await Bun.file(join(checkout, ".claude")).exists()).toBe(false);
    expect(await excludes(checkout)).toBe(false);
  });

  test("appends the exclude entry once across repeated runs", async () => {
    const { checkout, root } = await fixture();

    await link(checkout, root);
    await link(checkout, root);

    const exclude = await Bun.file(excludePath(checkout)).text();
    expect(exclude.split("\n").filter((line) => line === "/.claude")).toHaveLength(1);
  });
});

describe("overlayStatus", () => {
  test("reports the key, the overlay, and an unlinked checkout", async () => {
    const { checkout, overlay, root } = await fixture();

    expect(await overlayStatus(checkout, root)).toEqual({
      checkout,
      key: KEY,
      overlay,
      exists: true,
      state: { kind: "missing" },
    });
  });

  test("falls back to origin when there is no upstream", async () => {
    const { checkout, root } = await fixture();
    await git(checkout, ["remote", "remove", "upstream"]);
    await git(checkout, [
      "remote",
      "add",
      "origin",
      "https://github.com/bendrucker/extensions.git",
    ]);

    const status = await overlayStatus(checkout, root);

    expect(status.key).toBe("bendrucker/extensions");
    expect(status.exists).toBe(false);
  });

  test("reports no key outside a repository with remotes", async () => {
    const { checkout, root } = await fixture();
    await git(checkout, ["remote", "remove", "upstream"]);

    expect(await overlayStatus(checkout, root)).toEqual({
      checkout,
      key: null,
      overlay: null,
      exists: false,
      state: null,
    });
  });
});
