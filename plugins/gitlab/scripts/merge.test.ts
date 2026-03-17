import { describe, expect, mock, test } from "bun:test";
import type { MergeActions } from "./merge";
import { merge } from "./merge";

function createActions(overrides: Partial<MergeActions> = {}): MergeActions {
  return {
    getProjectConfig: mock(() => Promise.resolve({ id: 42, merge_trains_enabled: false })),
    getMrIid: mock(() => Promise.resolve(10)),
    addToMergeTrain: mock(() => Promise.resolve()),
    mergeViaGlab: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("merge", () => {
  test("uses merge train API when merge trains enabled and auto-merge requested", async () => {
    const actions = createActions({
      getProjectConfig: mock(() => Promise.resolve({ id: 42, merge_trains_enabled: true })),
    });

    await merge("feature", { autoMerge: true }, actions);

    expect(actions.getMrIid).toHaveBeenCalledWith("feature");
    expect(actions.addToMergeTrain).toHaveBeenCalledWith({
      projectId: 42,
      iid: 10,
      squash: undefined,
    });
    expect(actions.mergeViaGlab).not.toHaveBeenCalled();
  });

  test("uses glab mr merge when merge trains disabled", async () => {
    const actions = createActions();

    await merge("feature", { autoMerge: true }, actions);

    expect(actions.mergeViaGlab).toHaveBeenCalledWith("feature", true);
    expect(actions.addToMergeTrain).not.toHaveBeenCalled();
  });

  test("uses glab mr merge when auto-merge not requested", async () => {
    const actions = createActions({
      getProjectConfig: mock(() => Promise.resolve({ id: 42, merge_trains_enabled: true })),
    });

    await merge("feature", { autoMerge: false }, actions);

    expect(actions.mergeViaGlab).toHaveBeenCalledWith("feature", false);
    expect(actions.addToMergeTrain).not.toHaveBeenCalled();
  });

  test("throws when no open MR found for branch", async () => {
    const actions = createActions({
      getProjectConfig: mock(() => Promise.resolve({ id: 42, merge_trains_enabled: true })),
      getMrIid: mock(() => Promise.reject(new Error("No open MR found for branch: no-mr"))),
    });

    await expect(merge("no-mr", { autoMerge: true }, actions)).rejects.toThrow(
      "No open MR found for branch: no-mr",
    );
  });

  test("passes squash flag to merge train API", async () => {
    const actions = createActions({
      getProjectConfig: mock(() => Promise.resolve({ id: 42, merge_trains_enabled: true })),
    });

    await merge("feature", { autoMerge: true, squash: true }, actions);

    expect(actions.addToMergeTrain).toHaveBeenCalledWith({
      projectId: 42,
      iid: 10,
      squash: true,
    });
  });
});
