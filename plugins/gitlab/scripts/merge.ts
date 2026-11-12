#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";

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

const ShellFailure = z.looseObject({
  stdout: z.unknown().optional(),
  stderr: z.unknown().optional(),
});

export function errorText(err: unknown): string {
  // glab spreads a failure across both streams: `glab api` prints the HTTP error body
  // (the JSON message) to stdout and a `glab: <message> (HTTP <code>)` line to stderr.
  // Read both so the already-armed guard matches and callers see the full error text.
  const failure = ShellFailure.safeParse(err);
  const streams = (failure.success ? [failure.data.stdout, failure.data.stderr] : [])
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
      // oxlint-disable-next-line no-await-in-loop -- retry loop: an attempt runs only because the previous one failed transiently.
      await run();
      return;
    } catch (error) {
      const message = errorText(error);
      if (message.includes(ALREADY_ARMED)) {
        return;
      }
      if (attempt < MAX_ATTEMPTS && TRANSIENT.some((t) => message.includes(t))) {
        // oxlint-disable-next-line no-await-in-loop -- backoff between retries.
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

const ProjectConfig = z.looseObject({ merge_trains_enabled: z.boolean() });
type ProjectConfig = z.infer<typeof ProjectConfig>;

export async function getProjectConfig(): Promise<ProjectConfig> {
  return ProjectConfig.parse(await $`glab api projects/:id`.quiet().json());
}

export const MergeRequestDetail = z.looseObject({
  iid: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  web_url: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  detailed_merge_status: z.string(),
  has_conflicts: z.boolean(),
  blocking_discussions_resolved: z.boolean(),
  auto_merge_enabled: z.boolean().nullish(),
  head_pipeline: z.looseObject({ id: z.number(), status: z.string() }).nullish(),
});
export type MergeRequestDetail = z.infer<typeof MergeRequestDetail>;

export async function getMergeRequest(branch: string): Promise<MergeRequestDetail> {
  return MergeRequestDetail.parse(await $`glab mr view ${branch} -F json`.quiet().json());
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

export interface MergeOptions {
  autoMerge: boolean;
  squash?: boolean | undefined;
}

// `glab mr merge` turns auto-merge on by default whenever a pipeline is running, so
// omitting the flag arms the MR instead of merging it. Always send the caller's choice.
// On a merge-train project, GitLab routes an auto-merge to the train server-side.
export function mergeArgs(branch: string, opts: MergeOptions): string[] {
  return [branch, `--auto-merge=${opts.autoMerge}`, ...(opts.squash ? ["--squash"] : []), "-y"];
}

export async function mergeViaGlab(branch: string, opts: MergeOptions): Promise<void> {
  await arm(() => $`glab mr merge ${mergeArgs(branch, opts)}`);
}

export interface MergeActions {
  getProjectConfig: () => Promise<ProjectConfig>;
  getMergeRequest: (branch: string) => Promise<MergeRequestDetail>;
  isRebasedOnTarget: (target: string, source: string) => Promise<boolean | null>;
}

const defaultActions: MergeActions = {
  getProjectConfig,
  getMergeRequest,
  isRebasedOnTarget,
};

export type MergeRequestStatus = MergeRequestDetail & {
  merge_trains_enabled: boolean;
  rebased_on_target: boolean | null;
};

export async function status(
  branch: string,
  actions: MergeActions = defaultActions,
): Promise<MergeRequestStatus> {
  const [project, mr] = await Promise.all([
    actions.getProjectConfig(),
    actions.getMergeRequest(branch),
  ]);

  return {
    ...mr,
    merge_trains_enabled: project.merge_trains_enabled,
    rebased_on_target: await actions.isRebasedOnTarget(mr.target_branch, mr.source_branch),
  };
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

  const branch =
    argv._.branch != null && argv._.branch !== ""
      ? argv._.branch
      : (await $`git branch --show-current`.text()).trim();

  if (argv.flags.status) {
    console.log(JSON.stringify(await status(branch), null, 2));
  } else {
    await mergeViaGlab(branch, {
      autoMerge: argv.flags.autoMerge,
      squash: argv.flags.squash,
    });
  }
}
