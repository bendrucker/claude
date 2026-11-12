import { describe, expect, mock, test } from "bun:test";
import {
  type MergeActions,
  type MergeRequestDetail,
  arm,
  errorText,
  type MergeOptions,
  mergeArgs,
  status,
  streamText,
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
    title: "Add tenants config",
    state: "opened",
    draft: false,
    web_url: "https://gitlab.com/acme/tenants-config/-/merge_requests/10",
    source_branch: "feature",
    target_branch: "main",
    detailed_merge_status: "mergeable",
    has_conflicts: false,
    blocking_discussions_resolved: true,
    auto_merge_enabled: false,
    head_pipeline: { id: 7, status: "success" },
    ...overrides,
  };
}

function createActions(overrides: Partial<MergeActions> = {}): MergeActions {
  return {
    getProjectConfig: mock(() => Promise.resolve({ merge_trains_enabled: false })),
    getMergeRequest: mock(() => Promise.resolve(createMergeRequest())),
    isRebasedOnTarget: mock(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe("streamText", () => {
  test.each<[string, unknown, string]>([
    ["passes a string through untrimmed", "  body\n", "  body\n"],
    ["decodes a Uint8Array", new TextEncoder().encode("body"), "body"],
    ["drops a value that is not text", { code: 1 }, ""],
  ])("%s", (_name, stream, expected) => {
    expect(streamText(stream)).toBe(expected);
  });
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
    ["accepts string streams", { stdout: "body", stderr: "" }, "body"],
    ["trims surrounding whitespace", { stdout: encode("  body\n"), stderr: "" }, "body"],
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
  test.each<{ name: string; opts: MergeOptions; expected: string[] }>([
    {
      name: "auto-merge",
      opts: { autoMerge: true },
      expected: ["feature", "--auto-merge=true", "-y"],
    },
    {
      name: "immediate merge",
      opts: { autoMerge: false },
      expected: ["feature", "--auto-merge=false", "-y"],
    },
    {
      name: "squashed auto-merge",
      opts: { autoMerge: true, squash: true },
      expected: ["feature", "--auto-merge=true", "--squash", "-y"],
    },
  ])("$name", ({ opts, expected }) => {
    expect(mergeArgs("feature", opts)).toEqual(expected);
  });
});

describe("status", () => {
  test("reports merge readiness without merging", async () => {
    const actions = createActions({
      getProjectConfig: mock(() => Promise.resolve({ merge_trains_enabled: true })),
    });

    const result = await status("feature", actions);

    expect(result).toMatchObject({
      iid: 10,
      detailed_merge_status: "mergeable",
      merge_trains_enabled: true,
      rebased_on_target: true,
    });
    expect(actions.getMergeRequest).toHaveBeenCalledWith("feature");
    expect(actions.isRebasedOnTarget).toHaveBeenCalledWith("main", "feature");
  });

  test("surfaces a child MR still targeting a merged parent branch", async () => {
    const actions = createActions({
      getMergeRequest: mock(() =>
        Promise.resolve(createMergeRequest({ target_branch: "parent-layer" })),
      ),
      isRebasedOnTarget: mock(() => Promise.resolve(false)),
    });

    const result = await status("feature", actions);

    expect(result.target_branch).toBe("parent-layer");
    expect(result.rebased_on_target).toBe(false);
  });

  test("reports null when the ancestry check cannot run", async () => {
    const actions = createActions({
      isRebasedOnTarget: mock(() => Promise.resolve(null)),
    });

    expect((await status("feature", actions)).rebased_on_target).toBeNull();
  });

  test("throws when no MR is found for the branch", () => {
    const actions = createActions({
      getMergeRequest: mock(() => Promise.reject(new Error("no merge request found"))),
    });

    expect(status("no-mr", actions)).rejects.toThrow("no merge request found");
  });
});
