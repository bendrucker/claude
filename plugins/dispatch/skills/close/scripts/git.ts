import type { Runner } from "../../dispatch/scripts/dispatch";
import { trimmed } from "./text";

export interface GitFacts {
  toplevel: string | null;
  branch: string | null;
  head: string | null;
  dirty: number | null;
  ahead: number | null;
}

export const NO_GIT: GitFacts = {
  toplevel: null,
  branch: null,
  head: null,
  dirty: null,
  ahead: null,
};

function output(result: { code: number; stdout: string }): string | null {
  return result.code === 0 ? trimmed(result.stdout) : null;
}

export async function gitFacts(run: Runner, cwd: string): Promise<GitFacts> {
  const top = await run(["git", "rev-parse", "--show-toplevel"], { cwd });
  if (top.code !== 0) return NO_GIT;
  const [branch, head, status, upstream] = await Promise.all([
    run(["git", "branch", "--show-current"], { cwd }),
    run(["git", "rev-parse", "HEAD"], { cwd }),
    run(["git", "status", "--porcelain"], { cwd }),
    run(["git", "rev-list", "--count", "@{u}..HEAD"], { cwd }),
  ]);
  // A branch with no upstream counts the commits missing from every remote-tracking ref.
  const ahead =
    upstream.code === 0
      ? upstream
      : await run(["git", "rev-list", "--count", "HEAD", "--not", "--remotes"], { cwd });
  const count = Number(output(ahead) ?? Number.NaN);
  return {
    toplevel: output(top),
    branch: output(branch),
    head: output(head),
    dirty:
      status.code === 0
        ? status.stdout.split("\n").filter((line) => line.trim() !== "").length
        : null,
    ahead: Number.isInteger(count) ? count : null,
  };
}
