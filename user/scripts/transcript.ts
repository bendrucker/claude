// Transcripts grow to megabytes and only the tail holds the latest turns, so
// read a bounded suffix rather than the file. A mid-file slice splits the first
// line, which is dropped along with any other line that does not parse: a
// reader scanning backwards for the newest record of some shape must tolerate
// malformed lines rather than abort on the first one.
export async function readTranscriptTail(path: string, tailBytes: number): Promise<unknown[]> {
  try {
    const file = Bun.file(path);
    const size = file.size;
    if (size === 0) return [];

    const start = Math.max(0, size - tailBytes);
    const lines = (await file.slice(start).text()).split("\n");
    if (start > 0) lines.shift();

    const entries: unknown[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }
    return entries;
  } catch {
    return [];
  }
}
