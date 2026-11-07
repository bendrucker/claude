#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";

// glab has no merge-train command: `glab mr merge --auto-merge` hits the accept
// endpoint (PUT .../merge). GitLab 19.1+ resolves that to the train server-side,
// but we POST .../merge_trains/merge_requests/:iid directly so squash applies to
// the train add and the outcome doesn't depend on the instance version.

// Re-arming is idempotent: GitLab returns 409 "already set to Auto-Merge" when the
// MR is already armed, which counts as success for auto-merge only. A push clears the
// arm and briefly reports approvals_syncing before the arm can land, so retry through
// that window.
const ALREADY_ARMED = "already set to Auto-Merge";
const TRANSIENT = ["approvals_syncing"];
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

function streamText(stream: unknown): string {
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
  autoMerge = true,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retry loop: an attempt runs only because the previous one failed transiently.
      await run();
      return;
    } catch (error) {
      const message = errorText(error);
      if (autoMerge && message.includes(ALREADY_ARMED)) {
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

export function projectPath(repo?: string): string {
  return repo == null || repo === "" ? "projects/:id" : `projects/${encodeURIComponent(repo)}`;
}

function repoArgs(repo?: string): string[] {
  return repo == null || repo === "" ? [] : ["-R", repo];
}

// GitLab omits merge_trains_enabled on plans without merge trains.
export const ProjectConfig = z.looseObject({ merge_trains_enabled: z.boolean().default(false) });
type ProjectConfig = z.infer<typeof ProjectConfig>;

const MergeRequests = z.array(
  z.looseObject({ iid: z.number(), source_project_id: z.number(), target_project_id: z.number() }),
);

// Only an MR whose source branch lives in the target project counts, so a fork MR
// with the same branch name is never picked up.
export function pickMrIid(branch: string, mrs: z.infer<typeof MergeRequests>): number {
  const own = mrs.filter((mr) => mr.source_project_id === mr.target_project_id);
  const [mr, ...rest] = own;
  if (!mr) {
    throw new Error(`No open MR found for branch: ${branch}`);
  }
  if (rest.length > 0) {
    const iids = own.map((m) => `!${m.iid}`).join(", ");
    throw new Error(`Multiple open MRs for branch ${branch}: ${iids}. Pass an MR iid instead.`);
  }
  return mr.iid;
}

export const MergeRequestDetail = z.looseObject({
  iid: z.number(),
  state: z.string(),
  draft: z.boolean(),
  sha: z.string().nullish(),
  source_branch: z.string(),
  target_branch: z.string(),
  detailed_merge_status: z.string(),
  blocking_discussions_resolved: z.boolean(),
  auto_merge_enabled: z.boolean().nullish(),
  merge_when_pipeline_succeeds: z.boolean().nullish(),
  merge_user: z.looseObject({ username: z.string() }).nullish(),
  head_pipeline: z
    .looseObject({ id: z.number(), status: z.string(), sha: z.string().nullish() })
    .nullish(),
});
export type MergeRequestDetail = z.infer<typeof MergeRequestDetail>;

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
  sha?: string | undefined;
}

export function trainArgs(
  iid: number,
  opts: Pick<MergeOptions, "squash" | "sha">,
  repo?: string,
): string[] {
  const args = [
    "api",
    `${projectPath(repo)}/merge_trains/merge_requests/${iid}`,
    "-X",
    "POST",
    "-f",
    "auto_merge=true",
  ];
  if (opts.squash) args.push("-f", "squash=true");
  if (opts.sha != null && opts.sha !== "") args.push("-f", `sha=${opts.sha}`);
  return args;
}

// `glab mr merge` turns auto-merge on by default whenever a pipeline is running, so
// omitting the flag arms the MR instead of merging it. Always send the caller's choice.
export function mergeArgs(ref: string, opts: MergeOptions, repo?: string): string[] {
  const args = ["mr", "merge", ref, `--auto-merge=${opts.autoMerge}`, "-y"];
  if (opts.squash) args.push("--squash");
  if (opts.sha != null && opts.sha !== "") args.push("--sha", opts.sha);
  return [...args, ...repoArgs(repo)];
}

export interface MergeActions {
  getProjectConfig: () => Promise<ProjectConfig>;
  getMrIid: (branch: string) => Promise<number>;
  getMergeRequest: (iid: number) => Promise<MergeRequestDetail>;
  isRebasedOnTarget: (target: string, source: string) => Promise<boolean | null>;
  addToMergeTrain: (iid: number, opts: MergeOptions) => Promise<void>;
  mergeViaGlab: (ref: string, opts: MergeOptions) => Promise<void>;
}

export function glabActions(repo?: string): MergeActions {
  const base = projectPath(repo);
  return {
    getProjectConfig: async () => ProjectConfig.parse(await $`glab api ${base}`.json()),
    getMrIid: async (branch) =>
      pickMrIid(
        branch,
        MergeRequests.parse(
          await $`glab api ${base}/merge_requests -X GET -f source_branch=${branch} -f state=opened`.json(),
        ),
      ),
    getMergeRequest: async (iid) =>
      MergeRequestDetail.parse(await $`glab api ${base}/merge_requests/${iid}`.json()),
    // Ancestry needs the checkout's origin, which -R may not name.
    isRebasedOnTarget: (target, source) =>
      repo == null || repo === "" ? isRebasedOnTarget(target, source) : Promise.resolve(null),
    addToMergeTrain: (iid, opts) => arm(() => $`glab ${trainArgs(iid, opts, repo)}`),
    mergeViaGlab: (ref, opts) =>
      arm(() => $`glab ${mergeArgs(ref, opts, repo)}`, Bun.sleep, opts.autoMerge),
  };
}

export interface MergeRequestStatus {
  iid: number;
  state: string;
  draft: boolean;
  source_branch: string;
  target_branch: string;
  sha: string | null;
  detailed_merge_status: string;
  blocking_discussions_resolved: boolean;
  auto_merge: boolean;
  merge_user: string | null;
  head_pipeline: { id: number; status: string; sha: string | null } | null;
  merge_trains_enabled: boolean;
  rebased_on_target: boolean | null;
}

async function resolveIid(ref: string, actions: MergeActions): Promise<number> {
  return /^\d+$/.test(ref) ? Number(ref) : actions.getMrIid(ref);
}

export async function status(refs: string[], actions: MergeActions): Promise<MergeRequestStatus[]> {
  const project = await actions.getProjectConfig();
  const mrs = await Promise.all(
    refs.map(async (ref) => actions.getMergeRequest(await resolveIid(ref, actions))),
  );

  const results: MergeRequestStatus[] = [];
  for (const mr of mrs) {
    results.push({
      iid: mr.iid,
      state: mr.state,
      draft: mr.draft,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      sha: mr.sha ?? null,
      detailed_merge_status: mr.detailed_merge_status,
      blocking_discussions_resolved: mr.blocking_discussions_resolved,
      auto_merge: mr.auto_merge_enabled ?? mr.merge_when_pipeline_succeeds ?? false,
      merge_user: mr.merge_user?.username ?? null,
      head_pipeline: mr.head_pipeline
        ? {
            id: mr.head_pipeline.id,
            status: mr.head_pipeline.status,
            sha: mr.head_pipeline.sha ?? null,
          }
        : null,
      merge_trains_enabled: project.merge_trains_enabled,
      // oxlint-disable-next-line no-await-in-loop -- each check runs git fetch against the same remote.
      rebased_on_target: await actions.isRebasedOnTarget(mr.target_branch, mr.source_branch),
    });
  }
  return results;
}

export async function merge(ref: string, opts: MergeOptions, actions: MergeActions): Promise<void> {
  if (opts.autoMerge && (await actions.getProjectConfig()).merge_trains_enabled) {
    const iid = await resolveIid(ref, actions);
    console.log(`Merge trains enabled: adding !${iid} (${ref}) to merge train`);
    await actions.addToMergeTrain(iid, opts);
  } else {
    await actions.mergeViaGlab(ref, opts);
  }
}

export async function currentBranch(): Promise<string> {
  const branch = (await $`git branch --show-current`.text()).trim();
  if (branch === "") {
    throw new Error("Detached HEAD: pass a branch name or MR iid");
  }
  return branch;
}

if (import.meta.main) {
  try {
    const argv = cli({
      name: "merge",
      parameters: ["[refs...]"],
      flags: {
        autoMerge: { type: Boolean, description: "Enable auto-merge", default: false },
        squash: { type: Boolean, description: "Squash commits when merging", default: false },
        sha: { type: String, description: "Merge only if the source branch head matches this SHA" },
        repo: {
          type: String,
          alias: "R",
          description: "Target group/project instead of the checkout",
        },
        status: {
          type: Boolean,
          description:
            "Print one JSON readiness line per MR (branch or iid) and exit without merging",
          default: false,
        },
      },
    });

    const actions = glabActions(argv.flags.repo);
    const refs = argv._.refs.length > 0 ? argv._.refs : [await currentBranch()];

    if (argv.flags.status) {
      for (const result of await status(refs, actions)) console.log(JSON.stringify(result));
    } else {
      const [ref, ...extra] = refs;
      if (ref == null || extra.length > 0) {
        throw new Error("Merging takes exactly one branch or MR iid");
      }
      await merge(
        ref,
        { autoMerge: argv.flags.autoMerge, squash: argv.flags.squash, sha: argv.flags.sha },
        actions,
      );
    }
  } catch (error) {
    console.error(errorText(error));
    process.exit(1);
  }
}
