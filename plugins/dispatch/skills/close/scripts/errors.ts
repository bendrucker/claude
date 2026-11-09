export class CloseError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CloseError";
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
