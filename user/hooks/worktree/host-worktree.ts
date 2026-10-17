import { sep } from "node:path";
import { realpath } from "../../scripts/realpath";

// A host such as the Claude desktop app creates the session's worktree itself
// and declares it in CLAUDE_CODE_HOST_WORKTREE. Claude Code honors the
// declaration only while the session folder sits inside it, so this does too.
// Returns the declared worktree, resolved, or null outside such a session.
export function hostWorktree(
  cwd: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const declared = env.CLAUDE_CODE_HOST_WORKTREE;
  if (declared == null || declared === "" || cwd == null || cwd === "") return null;
  const tree = realpath(declared);
  const current = realpath(cwd);
  if (tree == null || current == null) return null;
  const inside = current === tree || current.startsWith(tree.endsWith(sep) ? tree : tree + sep);
  return inside ? tree : null;
}
