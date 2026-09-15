import { expect, test } from "bun:test";
import { ranges, violation } from "./plugin-lockfiles";

test.each<{
  name: string;
  lockfile: string | null;
  pinned: Parameters<typeof violation>[2];
  manifest: Parameters<typeof violation>[3];
  expected: string | null;
}>([
  {
    name: "no lockfile",
    lockfile: null,
    pinned: null,
    manifest: { dependencies: { zod: "^4.4.3" } },
    expected: "git: declares dependencies with no lockfile, so the install is skipped",
  },
  {
    name: "lockfile pinning the declared ranges",
    lockfile: "package-lock.json",
    pinned: { dependencies: { zod: "^4.4.3" } },
    manifest: { dependencies: { zod: "^4.4.3" } },
    expected: null,
  },
  {
    name: "lockfile missing a newly declared dependency",
    lockfile: "package-lock.json",
    pinned: { dependencies: { zod: "^4.4.3" } },
    manifest: { dependencies: { zod: "^4.4.3", table: "^6.9.0" } },
    expected: "git: package-lock.json disagrees with package.json, so the install fails",
  },
  {
    name: "lockfile pinning a superseded range",
    lockfile: "package-lock.json",
    pinned: { dependencies: { zod: "^3.0.0" } },
    manifest: { dependencies: { zod: "^4.4.3" } },
    expected: "git: package-lock.json disagrees with package.json, so the install fails",
  },
  {
    name: "devDependencies drift, which npm ci also refuses",
    lockfile: "package-lock.json",
    pinned: { dependencies: { zod: "^4.4.3" }, devDependencies: { "fast-check": "^4.8.0" } },
    manifest: { dependencies: { zod: "^4.4.3" } },
    expected: "git: package-lock.json disagrees with package.json, so the install fails",
  },
  {
    name: "bun.lock, whose ranges this script does not read",
    lockfile: "bun.lock",
    pinned: null,
    manifest: { dependencies: { zod: "^4.4.3" } },
    expected: null,
  },
])("$name", ({ lockfile, pinned, manifest, expected }) => {
  expect(violation("git", lockfile, pinned, manifest)).toBe(expected);
});

test("ranges ignores declaration order", () => {
  expect(ranges({ dependencies: { zod: "^4.4.3", table: "^6.9.0" } })).toBe(
    ranges({ dependencies: { table: "^6.9.0", zod: "^4.4.3" } }),
  );
});

test("ranges separates a dependency from a devDependency of the same name", () => {
  expect(ranges({ dependencies: { zod: "^4.4.3" } })).not.toBe(
    ranges({ devDependencies: { zod: "^4.4.3" } }),
  );
});
