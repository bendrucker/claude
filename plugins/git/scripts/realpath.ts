import { realpathSync } from "node:fs";

export function realpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return null;
    }
    throw error;
  }
}
