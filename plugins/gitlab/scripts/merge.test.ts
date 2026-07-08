import { describe, expect, mock, test } from "bun:test";
import type { MergeActions } from "./merge";
import { arm, merge } from "./merge";

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

describe("arm", () => {
  test("resolves on success without sleeping", async () => {
    const run = mock(() => Promise.resolve());
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("treats already-armed 409 as success", async () => {
    const run = mock(() =>
      Promise.reject(new Error('{"message":"Merge request is already set to Auto-Merge"}')),
    );
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries through approvals_syncing then succeeds", async () => {
    let calls = 0;
    const run = mock(() => {
      calls++;
      return calls < 3
        ? Promise.reject(new Error("approvals_syncing, try again later"))
        : Promise.resolve();
    });
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("throws after exhausting retries on a persistent transient", async () => {
    const run = mock(() => Promise.reject(new Error("approvals_syncing")));
    const sleep = mock(() => Promise.resolve());

    await expect(arm(run, sleep)).rejects.toThrow("approvals_syncing");
    expect(run).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  test("rethrows a non-transient error immediately", async () => {
    const run = mock(() => Promise.reject(new Error("404 Not Found")));
    const sleep = mock(() => Promise.resolve());

    await expect(arm(run, sleep)).rejects.toThrow("404 Not Found");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("reads the message from a shell error's stderr", async () => {
    const run = mock(() =>
      Promise.reject({ stderr: Buffer.from("... already set to Auto-Merge ...") }),
    );
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
  });

  test("reads the error body from stdout when stderr is empty", async () => {
    const run = mock(() =>
      Promise.reject({
        stdout: Buffer.from('{"message":"Merge request is already set to Auto-Merge"}'),
        stderr: Buffer.from(""),
      }),
    );
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("falls back to the Error message when both streams are empty", async () => {
    const run = mock(() =>
      Promise.reject(
        Object.assign(new Error("glab exited with code 1"), { stderr: Buffer.from("") }),
      ),
    );
    const sleep = mock(() => Promise.resolve());

    await expect(arm(run, sleep)).rejects.toThrow("glab exited with code 1");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
