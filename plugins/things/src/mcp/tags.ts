/**
 * Resolves a write's tags against the tags Things already holds, so an unknown
 * tag fails the call instead of being dropped on the floor.
 *
 * The pure matching lives in `scripts/tags.ts`; this is the IO shell around it,
 * with the Things calls behind an injectable seam the way `dispatch` puts its
 * runner behind `DispatchActions`.
 */

import { resolveTags } from "../../scripts/tags";
import { runScript } from "./jxa";

export interface TagActions {
  fetchTags(): Promise<string[]>;
  createTags(names: string[]): Promise<void>;
}

async function fetchTags(): Promise<string[]> {
  const tags = (await runScript("query-metadata.js", ["tags"])) as Array<{ name: string }>;
  return tags.map((tag) => tag.name);
}

async function createTags(names: string[]): Promise<void> {
  await runScript("create-tags.js", names);
}

const defaultActions: TagActions = { fetchTags, createTags };

export type TagRequirer = (requested: string[], createMissing: boolean) => Promise<string[]>;

/**
 * Builds a requirer over its own cache of Things' tag list. The fetch measures
 * around two seconds, which is too much to spend on every write, so it is held
 * for the process lifetime.
 */
export function createTagRequirer(actions: TagActions = defaultActions): TagRequirer {
  let cached: string[] | null = null;

  async function existing(refetch = false): Promise<string[]> {
    if (refetch || cached === null) cached = await actions.fetchTags();
    return cached;
  }

  return async (requested, createMissing) => {
    let resolution = resolveTags(requested, await existing());
    if (resolution.unknown.length === 0) return resolution.resolved;

    // A tag created in the Things UI after the cache warmed would otherwise
    // read as unknown, so a miss buys one refetch before it becomes a failure.
    resolution = resolveTags(requested, await existing(true));
    if (resolution.unknown.length === 0) return resolution.resolved;

    if (!createMissing) {
      throw new Error(
        `Tag not found: ${resolution.unknown.join(", ")}. ` +
          `Existing tags: ${(await existing()).join(", ")}. ` +
          "Pass create_tags to create the missing ones.",
      );
    }

    await actions.createTags(resolution.unknown);
    const created = resolveTags(requested, await existing(true));
    if (created.unknown.length > 0) {
      throw new Error(`Things did not create: ${created.unknown.join(", ")}`);
    }
    return created.resolved;
  };
}

export const requireTags: TagRequirer = createTagRequirer();
