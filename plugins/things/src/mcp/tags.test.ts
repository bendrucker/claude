import { describe, expect, test } from "bun:test";
import { createTagRequirer, type TagActions } from "./tags";

/**
 * Serves a mutable tag list and counts what the requirer asked Things for, so a
 * test can assert the cache is used and the refetch happens exactly once.
 */
function stubActions(initial: string[]) {
  const state = {
    tags: [...initial],
    fetches: 0,
    created: [] as string[][],
  };
  const actions: TagActions = {
    fetchTags: () => {
      state.fetches += 1;
      return Promise.resolve([...state.tags]);
    },
    createTags: (names) => {
      state.created.push(names);
      state.tags.push(...names);
      return Promise.resolve();
    },
  };
  return { state, actions };
}

describe("createTagRequirer", () => {
  test("resolves known tags from one fetch", async () => {
    const { state, actions } = stubActions(["claude", "review"]);
    const require = createTagRequirer(actions);

    expect(await require(["CLAUDE"], false)).toEqual(["claude"]);
    expect(await require(["review"], false)).toEqual(["review"]);
    expect(state.fetches).toBe(1);
  });

  // A tag created in the Things UI after the cache warmed would otherwise fail
  // a write that names it.
  test("refetches once before calling a tag unknown", async () => {
    const { state, actions } = stubActions(["claude"]);
    const require = createTagRequirer(actions);
    await require(["claude"], false);

    state.tags.push("bug");
    expect(await require(["bug"], false)).toEqual(["bug"]);
    expect(state.fetches).toBe(2);
  });

  test("names the unknown tags and what Things holds", () => {
    const { actions } = stubActions(["claude"]);
    const require = createTagRequirer(actions);

    expect(require(["bug", "review"], false)).rejects.toThrow(
      "Tag not found: bug, review. Existing tags: claude. Pass create_tags to create the missing ones.",
    );
  });

  test("creates only the missing tags when asked", async () => {
    const { state, actions } = stubActions(["claude"]);
    const require = createTagRequirer(actions);

    expect(await require(["claude", "bug"], true)).toEqual(["claude", "bug"]);
    expect(state.created).toEqual([["bug"]]);
  });

  test("reports a tag Things accepted the create for but does not hold", () => {
    const { actions } = stubActions([]);
    const require = createTagRequirer({ ...actions, createTags: () => Promise.resolve() });

    expect(require(["bug"], true)).rejects.toThrow("Things did not create: bug");
  });
});
