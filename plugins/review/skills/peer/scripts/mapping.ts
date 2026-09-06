import { cli, command } from "cleye";
import { decodeComments, type ReviewComment } from "./comment";
import { parseDiff } from "./diff";
import { toGitHubComment, toGitLabPosition, validateInDiff } from "./platform";

const mapCmd = command(
  {
    name: "map",
    flags: {
      platform: { type: String, description: "Target platform: github or gitlab" },
      comments: { type: String, description: "Path to comments JSON ({comments:[...]} or [...])" },
      diff: { type: String, description: "Path to unified diff text" },
      commit: { type: String, description: "Head commit SHA" },
      base: { type: String, description: "Base SHA (gitlab)" },
      start: { type: String, description: "Start SHA (gitlab)" },
    },
  },
  async (parsed) => {
    const { platform, comments, diff, commit, base, start } = parsed.flags;

    if (platform !== "github" && platform !== "gitlab") {
      console.error("--platform must be github or gitlab");
      process.exit(1);
    }
    if (comments === undefined || diff === undefined || commit === undefined) {
      console.error("--comments, --diff, and --commit are required");
      process.exit(1);
    }
    if (platform === "gitlab" && (base === undefined || start === undefined)) {
      console.error("gitlab requires --base and --start");
      process.exit(1);
    }

    let commentList: ReviewComment[];
    let diffText: string;
    try {
      commentList = decodeComments(await Bun.file(comments).text());
      diffText = await Bun.file(diff).text();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const parsedDiff = parseDiff(diffText);
    const payloads: unknown[] = [];
    const dropped: { id: string; reason: string }[] = [];

    for (const comment of commentList) {
      const result = validateInDiff(comment, parsedDiff);
      if (!result.ok) {
        dropped.push({ id: comment.id, reason: result.reason });
        continue;
      }
      if (platform === "github") {
        payloads.push(toGitHubComment(comment, { commitId: commit }));
      } else if (base !== undefined && start !== undefined && comment.path !== null) {
        const fileDiff = parsedDiff.get(comment.path);
        const opts: { newPath: string; oldPath?: string } = { newPath: comment.path };
        if (fileDiff?.oldPath !== undefined) opts.oldPath = fileDiff.oldPath;
        const position = toGitLabPosition(
          comment,
          { base_sha: base, head_sha: commit, start_sha: start },
          opts,
        );
        payloads.push({ body: comment.content, position });
      }
    }

    console.log(JSON.stringify({ platform, payloads, dropped }, null, 2));
  },
);

if (import.meta.main) {
  await cli({
    name: "mapping",
    commands: [mapCmd],
  });
}
