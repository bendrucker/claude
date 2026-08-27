#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";

// glab has no merge-train command: `glab mr merge --auto-merge` hits the accept
// endpoint (PUT .../merge). GitLab 19.1+ resolves that to the train server-side,
// but we POST .../merge_trains/merge_requests/:iid directly so squash applies to
// the train add and the outcome doesn't depend on the instance version.

// Re-arming is idempotent: GitLab returns 409 "already set to Auto-Merge" when the
// MR is already armed, which we treat as success. A push clears the arm and briefly
// reports approvals_syncing before the arm can land, so retry through that window.
const ALREADY_ARMED = "already set to Auto-Merge";
const TRANSIENT = ["approvals_syncing"];
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

export function streamText(stream: unknown): string {
  if (typeof stream === "string") return stream;
  if (stream instanceof Uint8Array) return new TextDecoder().decode(stream);
  return "";
}

export function errorText(err: unknown): string {
  // glab spreads a failure across both streams: `glab api` prints the HTTP error body
  // (the JSON message) to stdout and a `glab: <message> (HTTP <code>)` line to stderr.
  // Read both so the already-armed guard matches and callers see the full error text.
  const record = err as Record<string, unknown>;
  const streams = [record?.stdout, record?.stderr]
    .map((stream) => streamText(stream).trim())
    .filter((text) => text.length > 0);
  if (streams.length > 0) {
    return streams.join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

export async function arm(
  // arm discards what run resolves to, and Promise<void> rejects callers
  // returning a real value.
  // oxlint-disable-next-line local/no-unknown-returns
  run: () => Promise<unknown>,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      const message = errorText(err);
      if (message.includes(ALREADY_ARMED)) {
        return;
      }
      if (attempt < MAX_ATTEMPTS && TRANSIENT.some((t) => message.includes(t))) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

interface ProjectConfig {
  id: number;
  merge_trains_enabled: boolean;
}

export async function getProjectConfig(): Promise<ProjectConfig> {
  return $`glab api projects/:id`.json();
}

interface MergeRequest {
  iid: number;
}

export async function getMrIid(branch: string): Promise<number> {
  const mrs: MergeRequest[] =
    await $`glab api projects/:id/merge_requests -X GET --field source_branch=${branch} --field state=opened`.json();

  const [mr] = mrs;
  if (!mr) {
    throw new Error(`No open MR found for branch: ${branch}`);
  }

  return mr.iid;
}

export interface MergeRequestDetail {
  iid: number;
  title: string;
  state: string;
  draft: boolean;
  web_url: string;
  source_branch: string;
  target_branch: string;
  detailed_merge_status: string;
  has_conflicts: boolean;
  blocking_discussions_resolved: boolean;
  auto_merge_enabled?: boolean;
  head_pipeline?: { id: number; status: string } | null;
}

export async function getMergeRequest(iid: number): Promise<MergeRequestDetail> {
  return $`glab api projects/:id/merge_requests/${iid}`.json();
}

// The API's has_conflicts/detailed_merge_status stay stale for minutes after a
// rebase, so ancestry against the fetched target ref is the reliable "is this
// rebased" signal. Returns null when either remote ref is missing locally.
export async function isRebasedOnTarget(target: string, source: string): Promise<boolean | null> {
  await $`git fetch --quiet origin ${target} ${source}`.nothrow().quiet();

  const refs = await Promise.all(
    [target, source].map((branch) =>
      $`git rev-parse --verify --quiet origin/${branch}`.nothrow().quiet(),
    ),
  );
  if (refs.some((ref) => ref.exitCode !== 0)) {
    return null;
  }

  const ancestor = await $`git merge-base --is-ancestor origin/${target} origin/${source}`
    .nothrow()
    .quiet();
  return ancestor.exitCode === 0;
}

interface MergeTrainOptions {
  projectId: number;
  iid: number;
  squash?: boolean | undefined;
}

export async function addToMergeTrain(opts: MergeTrainOptions): Promise<void> {
  const fields = ["--raw-field auto_merge=true"];
  if (opts.squash) {
    fields.push("--raw-field squash=true");
  }

  await arm(
    () =>
      $`glab api projects/${opts.projectId}/merge_trains/merge_requests/${opts.iid} -X POST ${{ raw: fields.join(" ") }}`,
  );
}

// `glab mr merge` turns auto-merge on by default whenever a pipeline is running, so
// omitting the flag arms the MR instead of merging it. Always send the caller's choice.
export function mergeArgs(branch: string, autoMerge: boolean): string[] {
  return [branch, `--auto-merge=${autoMerge}`, "-y"];
}

export async function mergeViaGlab(branch: string, autoMerge: boolean): Promise<void> {
  await arm(() => $`glab mr merge ${mergeArgs(branch, autoMerge)}`);
}

export interface MergeActions {
  getProjectConfig(): Promise<ProjectConfig>;
  getMrIid(branch: string): Promise<number>;
  getMergeRequest(iid: number): Promise<MergeRequestDetail>;
  isRebasedOnTarget(target: string, source: string): Promise<boolean | null>;
  addToMergeTrain(opts: MergeTrainOptions): Promise<void>;
  mergeViaGlab(branch: string, autoMerge: boolean): Promise<void>;
}

const defaultActions: MergeActions = {
  getProjectConfig,
  getMrIid,
  getMergeRequest,
  isRebasedOnTarget,
  addToMergeTrain,
  mergeViaGlab,
};

export interface MergeRequestStatus extends MergeRequestDetail {
  merge_trains_enabled: boolean;
  rebased_on_target: boolean | null;
}

export async function status(
  branch: string,
  actions: MergeActions = defaultActions,
): Promise<MergeRequestStatus> {
  const project = await actions.getProjectConfig();
  const iid = await actions.getMrIid(branch);
  const mr = await actions.getMergeRequest(iid);

  return {
    ...mr,
    merge_trains_enabled: project.merge_trains_enabled,
    rebased_on_target: await actions.isRebasedOnTarget(mr.target_branch, mr.source_branch),
  };
}

export async function merge(
  branch: string,
  opts: { autoMerge: boolean; squash?: boolean },
  actions: MergeActions = defaultActions,
): Promise<void> {
  const project = await actions.getProjectConfig();

  if (project.merge_trains_enabled && opts.autoMerge) {
    const iid = await actions.getMrIid(branch);
    console.log(`Merge trains enabled: adding !${iid} (${branch}) to merge train`);
    await actions.addToMergeTrain({
      projectId: project.id,
      iid,
      squash: opts.squash,
    });
  } else {
    await actions.mergeViaGlab(branch, opts.autoMerge);
  }
}

if (import.meta.main) {
  const argv = cli({
    name: "merge",
    parameters: ["[branch]"],
    flags: {
      autoMerge: {
        type: Boolean,
        description: "Enable auto-merge",
        default: false,
      },
      squash: {
        type: Boolean,
        description: "Squash commits when merging",
        default: false,
      },
      status: {
        type: Boolean,
        description: "Print the MR's merge readiness as JSON and exit without merging",
        default: false,
      },
    },
  });

  const branch = argv._.branch || (await $`git branch --show-current`.text()).trim();

  if (argv.flags.status) {
    console.log(JSON.stringify(await status(branch), null, 2));
  } else {
    await merge(branch, {
      autoMerge: argv.flags.autoMerge,
      squash: argv.flags.squash,
    });
  }
}
