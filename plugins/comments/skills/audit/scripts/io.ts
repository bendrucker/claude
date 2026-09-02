/** Where the pipeline's human-facing lines go: stdout for results, stderr for warnings. */
export interface AuditIo {
  log(line: string): void;
  warn(line: string): void;
}

export const consoleIo: AuditIo = {
  log: (line) => console.log(line),
  warn: (line) => console.error(line),
};

/** A failure the user can act on. The CLI prints the message alone and exits 1. */
export class AuditError extends Error {}
