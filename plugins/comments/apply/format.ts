/**
 * Formatter pass for applied edits. The applier splices comment text by line,
 * so the result can carry debris a formatter would fix (stray blanks, long
 * collapsed lines). The caller supplies a shell command template; nothing is
 * auto-discovered or auto-executed beyond it.
 */

export interface FormatResult {
  content: string;
  formatted: boolean;
  /** Why the content was kept unformatted: exit code and stderr. */
  error?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The template with `{}` replaced by the shell-quoted repo-relative path. */
export function renderTemplate(template: string, path: string): string {
  return template.replaceAll("{}", shellQuote(path));
}

/**
 * Run the formatter template over one file's content: content on stdin, `{}`
 * in the template replaced with the file's path, stdout taken as the formatted
 * content. Runs in the current working directory (the repo root on the apply
 * path). A non-zero exit returns the original content with `formatted: false`.
 */
export async function formatContent(
  template: string,
  path: string,
  content: string,
): Promise<FormatResult> {
  const proc = Bun.spawn(["sh", "-c", renderTemplate(template, path)], {
    stdin: new TextEncoder().encode(content),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    return { content, formatted: false, error: `exit ${exitCode}: ${stderr.trim()}` };
  }
  // An in-place formatter (e.g. `ruff format {}` without `-`) exits 0 and prints
  // nothing. Taking its stdout would empty the file.
  if (content.trim().length > 0 && stdout.trim().length === 0) {
    return { content, formatted: false, error: "produced empty output for non-empty input" };
  }
  return { content: stdout, formatted: true };
}
