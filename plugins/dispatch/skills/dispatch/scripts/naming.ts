import type { DispatchOptions } from "./record";

const MAX_AGENT_NAME = 32;
const MAX_TASK_SUMMARY = 120;

export function deriveName(branch: string, taken: ReadonlySet<string>): string {
  const slug = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, MAX_AGENT_NAME);
  const base = slug === "" ? "agent" : slug;

  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) {
    const suffix = `-${n}`;
    candidate = base.slice(0, MAX_AGENT_NAME - suffix.length) + suffix;
  }
  return candidate;
}

export function deriveTitle(branch: string): string {
  const change = /^(pr|mr):(\d+)$/.exec(branch);
  if (change?.[1] != null) return `${change[1].toUpperCase()} ${change[2]}`;
  const url = /\/(pull|merge_requests)\/(\d+)\/?$/.exec(branch);
  if (url?.[1] != null) return `${url[1] === "pull" ? "PR" : "MR"} ${url[2]}`;
  const segments = branch.split("/");
  const words = (segments.length > 1 ? segments.slice(1) : segments)
    .join("/")
    .split(/[-_/]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length === 0 ? branch : words.join(" ");
}

export function taskSummary(prompt: string): string {
  // A prompt file often opens with a heading or a rule, so the summary is the
  // first line that still carries words once the markup is off the front.
  const line =
    prompt
      .split("\n")
      .map((entry) => entry.replace(/^[\s>#*+-]+/, "").trim())
      .find((entry) => /\w/.test(entry)) ?? "";
  return line.slice(0, MAX_TASK_SUMMARY);
}

export function titleOf(options: Pick<DispatchOptions, "title" | "branch">): string {
  return options.title ?? deriveTitle(options.branch);
}
