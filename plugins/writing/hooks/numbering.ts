import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  hasNumberingHint,
  markdownNumberingFindings,
  numberingMessage,
} from "../detection/numbering";
import { getExtension, isMarkdownFile } from "../detection/paths";
import { editedContent } from "./io";
import type { HookFinding } from "./report";

export { hasNumberingHint } from "../detection/numbering";

export type Mode = "write" | "edit";

const AstGrepMatches = z.array(z.looseObject({ message: z.string() }));

const ExecFailure = z.looseObject({ stdout: z.string().optional() });

export async function checkMarkdown(content: string): Promise<string | null> {
  const first = (await markdownNumberingFindings(content))[0];
  return first ? numberingMessage(first.text) : null;
}

export async function checkCode(content: string, ext: string): Promise<string | null> {
  try {
    execSync("command -v sg", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    // sg not installed must not fail the hook. Skip the ast-grep check.
    return null;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "hook-check-"));
  const tmpFile = join(tmpDir, `check.${ext}`);
  const ruleFile = join(import.meta.dirname, "numbering.yml");

  try {
    await Bun.write(tmpFile, content);

    // sg scan returns exit code 1 when matches are found (as errors)
    // We need to capture stdout regardless of exit code
    let result: string;
    try {
      result = execSync(`sg scan --rule "${ruleFile}" --json "${tmpFile}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      // execSync throws on non-zero exit, but we want stdout
      result = (ExecFailure.safeParse(error).data?.stdout ?? "").trim();
    }

    if (result !== "") {
      const matches = AstGrepMatches.parse(JSON.parse(result));
      return matches[0]?.message ?? null;
    }
  } catch {
    // sg failed or parse error
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return null;
}

async function fileAlreadyNumbered(filePath: string, ext: string): Promise<boolean> {
  let existing: string;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return false;
    existing = await file.text();
  } catch {
    // A missing or unreadable file must not fail the hook. Treat it as unnumbered.
    return false;
  }

  const match = isMarkdownFile(ext)
    ? await checkMarkdown(existing)
    : await checkCode(existing, ext);
  return match !== null;
}

export async function check(input: PreToolUseHookInput, mode: Mode): Promise<HookFinding[]> {
  const edited = editedContent(input);
  if (!edited) return [];
  const { content, filePath } = edited;

  if (!hasNumberingHint(content)) return [];

  const ext = getExtension(filePath);
  const match = isMarkdownFile(ext) ? await checkMarkdown(content) : await checkCode(content, ext);

  if (match == null || match === "") {
    return [];
  }

  // Numbering already present in the target file was adjudicated when it was
  // introduced (approved by the user or pre-existing). Only first
  // introductions should prompt.
  if (await fileAlreadyNumbered(filePath, ext)) {
    return [];
  }

  const reason = `Detected step or phase numbering that creates tight coupling.
${match}

Use descriptive names instead. See CLAUDE.md Organization guidelines.`;

  // Markdown numbering is advice, not a gate: the ask tier collected 52
  // prompts and 0 rejections, and an ask stalls background jobs. Code keeps
  // deny because blocking before the write is cheap and effective.
  if (isMarkdownFile(ext)) {
    const message =
      mode === "edit" ? `This edit introduces step or phase numbering. ${reason}` : reason;
    return [{ category: "numbering", tier: "context", message }];
  }

  return [{ category: "numbering", tier: "deny", message: reason }];
}
