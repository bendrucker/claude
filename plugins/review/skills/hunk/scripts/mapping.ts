import { cli, command } from "cleye";
import { parseDiff } from "./diff";
import { decodeNotes, type HunkNote } from "./note";
import { toGitHubComment, toGitLabPosition, validateInDiff } from "./platform";

const mapCmd = command(
  {
    name: "map",
    flags: {
      platform: { type: String, description: "Target platform: github or gitlab" },
      notes: { type: String, description: "Path to notes JSON ({comments:[...]} or [...])" },
      diff: { type: String, description: "Path to unified diff text" },
      commit: { type: String, description: "Head commit SHA" },
      base: { type: String, description: "Base SHA (gitlab)" },
      start: { type: String, description: "Start SHA (gitlab)" },
    },
  },
  async (parsed) => {
    const { platform, notes, diff, commit, base, start } = parsed.flags;

    if (platform !== "github" && platform !== "gitlab") {
      console.error("--platform must be github or gitlab");
      return process.exit(1);
    }
    if (notes === undefined || diff === undefined || commit === undefined) {
      console.error("--notes, --diff, and --commit are required");
      return process.exit(1);
    }
    if (platform === "gitlab" && (base === undefined || start === undefined)) {
      console.error("gitlab requires --base and --start");
      return process.exit(1);
    }

    let noteList: HunkNote[];
    let diffText: string;
    try {
      noteList = decodeNotes(await Bun.file(notes).text());
      diffText = await Bun.file(diff).text();
    } catch (error) {
      console.error((error as Error).message);
      return process.exit(1);
    }

    const parsedDiff = parseDiff(diffText);
    const payloads: unknown[] = [];
    const dropped: { noteId: string; reason: string }[] = [];

    for (const note of noteList) {
      const result = validateInDiff(note, parsedDiff);
      if (!result.ok) {
        dropped.push({ noteId: note.noteId, reason: result.reason });
        continue;
      }
      if (platform === "github") {
        payloads.push(toGitHubComment(note, { commitId: commit }));
      } else if (base !== undefined && start !== undefined) {
        const fileDiff = parsedDiff.get(note.filePath);
        const opts: { newPath: string; oldPath?: string } = { newPath: note.filePath };
        if (fileDiff?.oldPath !== undefined) opts.oldPath = fileDiff.oldPath;
        const position = toGitLabPosition(
          note,
          { base_sha: base, head_sha: commit, start_sha: start },
          opts,
        );
        payloads.push({ body: note.body, position });
      }
    }

    console.log(JSON.stringify({ platform, payloads, dropped }, null, 2));
  },
);

if (import.meta.main) {
  cli({
    name: "mapping",
    commands: [mapCmd],
  });
}
