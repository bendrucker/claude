export interface Capture {
  exit: number;
  stdout: string;
  stderr: string;
}

export interface Divergence {
  checkpoint: "exit" | "stdout" | "stderr";
  fingerprint: string;
  old: string;
  new: string;
}

const SNIPPET = 60;

function maskDigits(text: string): string {
  return text.replaceAll(/\d+/g, "9");
}

function clip(text: string): string {
  return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
}

function middles(a: string, b: string): [string, string] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end))
    end++;
  return [a.slice(start, a.length - end), b.slice(start, b.length - end)];
}

function kindOf(oldMid: string, newMid: string): string {
  if (oldMid.trim() === "" && newMid.trim() === "") return "whitespace";
  if (oldMid.toLowerCase() === newMid.toLowerCase()) return "case";
  if (/^[\d.,\s-]+$/.test(oldMid) && /^[\d.,\s-]+$/.test(newMid)) return "number";
  return "text";
}

function jsonValue(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonDiff(a: unknown, b: unknown, path: string): string | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}:length`;
    for (let i = 0; i < a.length; i++) {
      const found = jsonDiff(a[i], b[i], `${path}[]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in b)) return `${path}.${key}:missing`;
      if (!(key in a)) return `${path}.${key}:extra`;
      const found = jsonDiff(a[key], b[key], `${path}.${key}`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof a !== typeof b) return `${path}:type`;
  return a === b ? undefined : `${path}:value`;
}

function lines(text: string): string[] {
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

function streamDiff(
  oldText: string,
  newText: string,
): { fingerprint: string; old: string; new: string } {
  const oldJson = jsonValue(oldText);
  const newJson = jsonValue(newText);
  if (oldJson.ok && newJson.ok) {
    const path = jsonDiff(oldJson.value, newJson.value, "$") ?? "$:format";
    return { fingerprint: `json:${path}`, old: clip(oldText), new: clip(newText) };
  }
  if (oldText.trimEnd() === newText.trimEnd()) {
    return {
      fingerprint: "trailing-whitespace",
      old: JSON.stringify(oldText.slice(-5)),
      new: JSON.stringify(newText.slice(-5)),
    };
  }
  const oldLines = lines(oldText);
  const newLines = lines(newText);
  if (
    oldLines.length === newLines.length &&
    oldLines.toSorted().join("\n") === newLines.toSorted().join("\n")
  ) {
    return { fingerprint: "line-order", old: "", new: "" };
  }
  let i = 0;
  while (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) i++;
  const oldLine = oldLines[i];
  const newLine = newLines[i];
  if (oldLine === undefined || newLine === undefined) {
    const kind = oldLine === undefined ? "extra-line" : "missing-line";
    const line = oldLine ?? newLine ?? "";
    return {
      fingerprint: `${kind}:${clip(maskDigits(line))}`,
      old: clip(oldLine ?? ""),
      new: clip(newLine ?? ""),
    };
  }
  if (newLines.includes(oldLine)) {
    return { fingerprint: "line-moved", old: clip(oldLine), new: clip(newLine) };
  }
  const [oldMid, newMid] = middles(oldLine, newLine);
  const kind = kindOf(oldMid, newMid);
  const shape =
    kind === "number"
      ? `:${clip(maskDigits(oldLine).trim())}`
      : `:${clip(maskDigits(oldMid))}→${clip(maskDigits(newMid))}`;
  return { fingerprint: `${kind}${shape}`, old: clip(oldLine), new: clip(newLine) };
}

export function firstDivergence(oldRun: Capture, newRun: Capture): Divergence | undefined {
  if (oldRun.exit !== newRun.exit) {
    return {
      checkpoint: "exit",
      fingerprint: `exit:${oldRun.exit}→${newRun.exit}`,
      old: String(oldRun.exit),
      new: String(newRun.exit),
    };
  }
  for (const checkpoint of ["stdout", "stderr"] as const) {
    if (oldRun[checkpoint] !== newRun[checkpoint]) {
      const diff = streamDiff(oldRun[checkpoint], newRun[checkpoint]);
      return { checkpoint, ...diff, fingerprint: `${checkpoint}:${diff.fingerprint}` };
    }
  }
  return undefined;
}
