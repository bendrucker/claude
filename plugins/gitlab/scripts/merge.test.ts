import { describe, expect, mock, test } from "bun:test";
import {
  type MergeActions,
  type MergeRequestDetail,
  arm,
  errorText,
  merge,
  mergeArgs,
  ProjectConfig,
  pickMrIid,
  projectPath,
  status,
  trainArgs,
} from "./merge";

function shellError(streams: { stdout?: string; stderr?: string }): Error {
  return Object.assign(new Error("glab exited non-zero"), {
    stdout: Buffer.from(streams.stdout ?? ""),
    stderr: Buffer.from(streams.stderr ?? ""),
  });
}

function createMergeRequest(overrides: Partial<MergeRequestDetail> = {}): MergeRequestDetail {
  return {
    iid: 10,
    state: "opened",
    draft: false,
    sha: "abc123",
    source_branch: "feature",
    target_branch: "main",
    detailed_merge_status: "mergeable",
    blocking_discussions_resolved: true,
    auto_merge_enabled: false,
    head_pipeline: { id: 7, status: "success", sha: "abc123" },
    ...overrides,
  };
}

function createActions(overrides: Partial<MergeActions> = {}): MergeActions {
  return {
    getProjectConfig: mock(() => Promise.resolve({ merge_trains_enabled: false })),
    getMrIid: mock(() => Promise.resolve(10)),
    getMergeRequest: mock(() => Promise.resolve(createMergeRequest())),
    isRebasedOnTarget: mock(() => Promise.resolve(true)),
    addToMergeTrain: mock(() => Promise.resolve()),
    mergeViaGlab: mock(() => Promise.resolve()),
    ...overrides,
  };
}

const trains = () => ({
  getProjectConfig: mock(() => Promise.resolve({ merge_trains_enabled: true })),
});

describe("errorText", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  test.each<[string, unknown, string]>([
    [
      "decodes Buffer streams",
      { stdout: encode('{"message":"denied"}'), stderr: encode("") },
      '{"message":"denied"}',
    ],
    [
      "joins both streams",
      { stdout: encode("body"), stderr: encode("glab: boom (HTTP 500)") },
      "body\nglab: boom (HTTP 500)",
    ],
    ["trims surrounding whitespace", { stdout: encode("  body\n"), stderr: encode("") }, "body"],
    [
      "skips streams that are not text",
      { stdout: { code: 1 }, stderr: encode("glab: boom") },
      "glab: boom",
    ],
    ["falls back to the Error message", new Error("network down"), "network down"],
    ["falls back to the raw value", "plain failure", "plain failure"],
  ])("%s", (_name, err, expected) => {
    expect(errorText(err)).toBe(expected);
  });
});

describe("merge", () => {
  test("uses merge train API when merge trains enabled and auto-merge requested", async () => {
    const actions = createActions(trains());

    await merge("feature", { autoMerge: true }, actions);

    expect(actions.getMrIid).toHaveBeenCalledWith("feature");
    expect(actions.addToMergeTrain).toHaveBeenCalledWith(10, { autoMerge: true });
    expect(actions.mergeViaGlab).not.toHaveBeenCalled();
  });

  test("uses glab mr merge when merge trains disabled", async () => {
    const actions = createActions();

    await merge("feature", { autoMerge: true }, actions);

    expect(actions.mergeViaGlab).toHaveBeenCalledWith("feature", { autoMerge: true });
    expect(actions.addToMergeTrain).not.toHaveBeenCalled();
  });

  test("skips the project read when auto-merge is not requested", async () => {
    const actions = createActions(trains());

    await merge("feature", { autoMerge: false }, actions);

    expect(actions.mergeViaGlab).toHaveBeenCalledWith("feature", { autoMerge: false });
    expect(actions.getProjectConfig).not.toHaveBeenCalled();
    expect(actions.addToMergeTrain).not.toHaveBeenCalled();
  });

  test("takes an iid without resolving a branch", async () => {
    const actions = createActions(trains());

    await merge("1298", { autoMerge: true }, actions);

    expect(actions.getMrIid).not.toHaveBeenCalled();
    expect(actions.addToMergeTrain).toHaveBeenCalledWith(1298, { autoMerge: true });
  });

  test("throws when no open MR found for branch", () => {
    const actions = createActions({
      ...trains(),
      getMrIid: mock(() => Promise.reject(new Error("No open MR found for branch: no-mr"))),
    });

    expect(merge("no-mr", { autoMerge: true }, actions)).rejects.toThrow(
      "No open MR found for branch: no-mr",
    );
  });

  test("passes squash and sha to the merge train API", async () => {
    const actions = createActions(trains());

    await merge("feature", { autoMerge: true, squash: true, sha: "abc" }, actions);

    expect(actions.addToMergeTrain).toHaveBeenCalledWith(10, {
      autoMerge: true,
      squash: true,
      sha: "abc",
    });
  });

  test("passes squash to glab mr merge when trains are off", async () => {
    const actions = createActions();

    await merge("feature", { autoMerge: false, squash: true }, actions);

    expect(actions.mergeViaGlab).toHaveBeenCalledWith("feature", {
      autoMerge: false,
      squash: true,
    });
  });
});

describe("pickMrIid", () => {
  const mr = (iid: number, source: number, target: number) => ({
    iid,
    source_project_id: source,
    target_project_id: target,
  });

  test("ignores a fork MR with the same source branch name", () => {
    expect(pickMrIid("feature", [mr(5, 99, 1), mr(6, 1, 1)])).toBe(6);
  });

  test("throws when only a fork MR matches", () => {
    expect(() => pickMrIid("feature", [mr(5, 99, 1)])).toThrow("No open MR found");
  });

  test("throws when more than one MR matches", () => {
    expect(() => pickMrIid("feature", [mr(5, 1, 1), mr(6, 1, 1)])).toThrow("!5, !6");
  });
});

describe("projectPath", () => {
  test.each<[string | undefined, string]>([
    [undefined, "projects/:id"],
    ["", "projects/:id"],
    ["group/sub/project", "projects/group%2Fsub%2Fproject"],
  ])("maps %p to %s", (repo, expected) => {
    expect(projectPath(repo)).toBe(expected);
  });
});

describe("trainArgs", () => {
  test("sends fields as strings and targets the repo", () => {
    expect(trainArgs(4, { squash: true, sha: "abc" }, "g/p")).toEqual([
      "api",
      "projects/g%2Fp/merge_trains/merge_requests/4",
      "-X",
      "POST",
      "-f",
      "auto_merge=true",
      "-f",
      "squash=true",
      "-f",
      `sha=abc`,
    ]);
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

  test("rethrows already-armed when the merge is immediate", () => {
    const run = mock(() =>
      Promise.reject(new Error('{"message":"Merge request is already set to Auto-Merge"}')),
    );

    expect(
      arm(
        run,
        mock(() => Promise.resolve()),
        false,
      ),
    ).rejects.toThrow("already set");
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

  test("throws after exhausting retries on a persistent transient", () => {
    const run = mock(() => Promise.reject(new Error("approvals_syncing")));
    const sleep = mock(() => Promise.resolve());

    expect(arm(run, sleep)).rejects.toThrow("approvals_syncing");
    expect(run).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  test("rethrows a non-transient error immediately", () => {
    const run = mock(() => Promise.reject(new Error("404 Not Found")));
    const sleep = mock(() => Promise.resolve());

    expect(arm(run, sleep)).rejects.toThrow("404 Not Found");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("reads the message from a shell error's stderr", async () => {
    const run = mock(() =>
      Promise.reject(shellError({ stderr: "... already set to Auto-Merge ..." })),
    );
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
  });

  test("reads the error body from stdout when stderr is empty", async () => {
    const run = mock(() =>
      Promise.reject(
        shellError({ stdout: '{"message":"Merge request is already set to Auto-Merge"}' }),
      ),
    );
    const sleep = mock(() => Promise.resolve());

    await arm(run, sleep);

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("falls back to the Error message when both streams are empty", () => {
    const run = mock(() =>
      Promise.reject(
        Object.assign(new Error("glab exited with code 1"), { stderr: Buffer.from("") }),
      ),
    );
    const sleep = mock(() => Promise.resolve());

    expect(arm(run, sleep)).rejects.toThrow("glab exited with code 1");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("mergeArgs", () => {
  // glab enables auto-merge by default when a pipeline is running, so omitting the
  // flag silently queues the MR. Both branches must send it explicitly.
  test.each([
    [true, "--auto-merge=true"],
    [false, "--auto-merge=false"],
  ])("passes the auto-merge choice explicitly when autoMerge is %p", (autoMerge, flag) => {
    expect(mergeArgs("feature", { autoMerge })).toEqual(["mr", "merge", "feature", flag, "-y"]);
  });

  test("appends squash, sha, and repo", () => {
    expect(mergeArgs("feature", { autoMerge: false, squash: true, sha: "abc" }, "g/p")).toEqual([
      "mr",
      "merge",
      "feature",
      "--auto-merge=false",
      "-y",
      "--squash",
      "--sha",
      "abc",
      "-R",
      "g/p",
    ]);
  });
});

describe("status", () => {
  test("reports a compact projection without merging", async () => {
    const actions = createActions(trains());

    const [result] = await status(["feature"], actions);

    expect(result).toEqual({
      iid: 10,
      state: "opened",
      draft: false,
      source_branch: "feature",
      target_branch: "main",
      sha: "abc123",
      detailed_merge_status: "mergeable",
      blocking_discussions_resolved: true,
      auto_merge: false,
      merge_user: null,
      head_pipeline: { id: 7, status: "success", sha: "abc123" },
      merge_trains_enabled: true,
      rebased_on_target: true,
    });
    expect(actions.isRebasedOnTarget).toHaveBeenCalledWith("main", "feature");
    expect(actions.mergeViaGlab).not.toHaveBeenCalled();
    expect(actions.addToMergeTrain).not.toHaveBeenCalled();
  });

  test("reads several iids with one project read", async () => {
    const actions = createActions({
      getMergeRequest: mock((iid: number) => Promise.resolve(createMergeRequest({ iid }))),
    });

    const results = await status(["1298", "1299", "feature"], actions);

    expect(results.map((r) => r.iid)).toEqual([1298, 1299, 10]);
    expect(actions.getProjectConfig).toHaveBeenCalledTimes(1);
    expect(actions.getMrIid).toHaveBeenCalledTimes(1);
  });

  test("falls back to merge_when_pipeline_succeeds for auto-merge", async () => {
    const actions = createActions({
      getMergeRequest: mock(() =>
        Promise.resolve(
          createMergeRequest({
            auto_merge_enabled: undefined,
            merge_when_pipeline_succeeds: true,
            merge_user: { username: "ben" },
          }),
        ),
      ),
    });

    const [result] = await status(["10"], actions);

    expect(result?.auto_merge).toBe(true);
    expect(result?.merge_user).toBe("ben");
  });

  test("surfaces a child MR still targeting a merged parent branch", async () => {
    const actions = createActions({
      getMergeRequest: mock(() =>
        Promise.resolve(createMergeRequest({ target_branch: "parent-layer" })),
      ),
      isRebasedOnTarget: mock(() => Promise.resolve(false)),
    });

    const [result] = await status(["feature"], actions);

    expect(result?.target_branch).toBe("parent-layer");
    expect(result?.rebased_on_target).toBe(false);
  });

  test("reports null when the ancestry check cannot run", async () => {
    const actions = createActions({
      isRebasedOnTarget: mock(() => Promise.resolve(null)),
    });

    expect((await status(["feature"], actions))[0]?.rebased_on_target).toBeNull();
  });

  test("throws when no open MR found for branch", () => {
    const actions = createActions({
      getMrIid: mock(() => Promise.reject(new Error("No open MR found for branch: no-mr"))),
    });

    expect(status(["no-mr"], actions)).rejects.toThrow("No open MR found for branch: no-mr");
  });
});

describe("ProjectConfig", () => {
  test.each<{ name: string; input: object; expected: boolean }>([
    { name: "absent on a plan without trains", input: {}, expected: false },
    { name: "enabled", input: { merge_trains_enabled: true }, expected: true },
  ])("$name", ({ input, expected }) => {
    expect(ProjectConfig.parse(input).merge_trains_enabled).toBe(expected);
  });
});
