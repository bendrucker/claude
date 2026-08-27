import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectedComment } from "../detection/collect";
import { commentFeatures } from "../detection/features";
import { scoreComment } from "../detection/rank";
import { buildJob, writeJob } from "./job";
import { loadPrompt } from "./judge";

function collected(i: number): CollectedComment {
  const text = `// comment ${i}`;
  const comment = {
    kind: "line" as const,
    text,
    startLine: i + 1,
    endLine: i + 1,
    startColumn: 0,
    endColumn: text.length,
  };
  return {
    ...comment,
    path: `f${i}.ts`,
    language: "typescript",
    id: `id-${i}`,
    context: `ctx ${i}`,
    score: scoreComment(comment),
    features: commentFeatures(comment, [text]),
  };
}

function many(n: number): CollectedComment[] {
  return Array.from({ length: n }, (_, i) => collected(i));
}

describe("buildJob partitioning", () => {
  test.each([
    [0, []],
    [1, [1]],
    [20, [20]],
    [21, [20, 1]],
    [41, [20, 20, 1]],
  ])("partitions %i comments into shards of default size", async (n, sizes) => {
    const job = await buildJob(many(n), { fix: false });
    expect(job.shards.map((s) => s.comments.length)).toEqual(sizes);
    expect(job.shards.map((s) => s.id)).toEqual(sizes.map((_, i) => i));
  });

  test("preserves ranked order across shard boundaries", async () => {
    const job = await buildJob(many(41), { fix: false });
    const ids = job.shards.flatMap((s) => s.comments.map((c) => c.id));
    expect(ids).toEqual(many(41).map((c) => c.id));
  });

  test("honors an explicit shard size", async () => {
    const job = await buildJob(many(5), { fix: false, shardSize: 2 });
    expect(job.shards.map((s) => s.comments.length)).toEqual([2, 2, 1]);
  });
});

describe("buildJob prompt", () => {
  test("pins the prompt sha and leaves the rubric unchanged without --fix", async () => {
    const prompt = await loadPrompt();
    const job = await buildJob(many(1), { fix: false });
    expect(job.promptSha).toBe(prompt.sha256);
    expect(job.promptText).toBe(prompt.text);
  });

  test("appends the fix instruction with --fix", async () => {
    const prompt = await loadPrompt();
    const job = await buildJob(many(1), { fix: true });
    expect(job.promptText.startsWith(prompt.text)).toBe(true);
    expect(job.promptText).toContain("populate suggestedFix");
  });
});

describe("writeJob", () => {
  test("writes one file per shard plus args, with a content-keyed shard contract", async () => {
    const base = join(tmpdir(), `comments-job-test-${process.pid}`);
    try {
      const descriptor = await buildJob(many(21), { fix: false });
      const written = await writeJob(descriptor, base);

      expect(written.shardCount).toBe(2);
      expect(written.count).toBe(21);
      expect(written.shards).toHaveLength(2);
      expect(written.shards.map((s: { id: number }) => s.id)).toEqual([0, 1]);

      const firstShard = JSON.parse(await Bun.file(written.shards[0]?.path ?? "").text());
      expect(firstShard.comments).toHaveLength(20);

      const args = JSON.parse(await Bun.file(written.argsPath).text());
      expect(args.shards).toEqual(written.shards);
      expect(args.promptSha).toBe(descriptor.promptSha);
      expect(args.verdictsDir).toBe(written.verdictsDir);

      expect(args.promptText).toBeUndefined();
      expect(await Bun.file(args.promptPath).text()).toBe(descriptor.promptText);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("keys the job dir by content, so identical input reuses the dir", async () => {
    const base = join(tmpdir(), `comments-job-test-stable-${process.pid}`);
    try {
      const a = await writeJob(await buildJob(many(3), { fix: false }), base);
      const b = await writeJob(await buildJob(many(3), { fix: false }), base);
      expect(a.jobDir).toBe(b.jobDir);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
