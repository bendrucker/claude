import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { type Direction, type Filter, url } from "./bucket";

/** Copies files between a local directory and a bucket key, adding and overwriting but never deleting. */
export interface Storage {
  copy(direction: Direction, local: string, key: string, filters: Filter[]): Promise<void>;
}

export interface S3Options {
  /** `false` uses the credentials in the environment, as a cloud session must. */
  profile: string | false;
  dryRun?: true | undefined;
  run?: (args: string[]) => Promise<void>;
}

export function s3Args(
  direction: Direction,
  local: string,
  key: string,
  filters: Filter[],
  options: Pick<S3Options, "profile" | "dryRun">,
): string[] {
  const remote = url(key);
  const [from, to] = direction === "pull" ? [remote, local] : [local, remote];
  return [
    "s3",
    "sync",
    from,
    to,
    ...filters.flatMap((filter) =>
      "exclude" in filter ? ["--exclude", filter.exclude] : ["--include", filter.include],
    ),
    ...(options.profile === false ? [] : ["--profile", options.profile]),
    ...(options.dryRun ? ["--dryrun"] : []),
  ];
}

async function aws(args: string[]): Promise<void> {
  await $`aws ${args}`;
}

export function s3(options: S3Options): Storage {
  const run = options.run ?? aws;
  return {
    async copy(direction, local, key, filters) {
      await run(s3Args(direction, local, key, filters, options));
    },
  };
}

/** Translates an `aws s3` filter glob, where `*` also crosses `/`, into an anchored regex. */
function pattern(glob: string): RegExp {
  const source = RegExp.escape(glob)
    .replaceAll(String.raw`\*`, ".*")
    .replaceAll(String.raw`\?`, ".");
  return new RegExp(`^${source}$`);
}

export function included(path: string, filters: Filter[]): boolean {
  let keep = true;
  for (const filter of filters) {
    if ("exclude" in filter && pattern(filter.exclude).test(path)) keep = false;
    if ("include" in filter && pattern(filter.include).test(path)) keep = true;
  }
  return keep;
}

async function files(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** A bucket stand-in rooted at a local directory. Copies drop file modes, as S3 does. */
export function directory(root: string): Storage {
  return {
    async copy(direction, local, key, filters) {
      const remote = join(root, key);
      const [from, to] = direction === "pull" ? [remote, local] : [local, remote];
      const paths = (await files(from)).filter((path) => included(path, filters));
      await Promise.all(
        paths.map(async (path) =>
          Bun.write(join(to, path), await Bun.file(join(from, path)).arrayBuffer()),
        ),
      );
    },
  };
}
