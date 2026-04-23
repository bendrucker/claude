import { resolve } from "node:path";

const MEMORY_PATH_PATTERN = /\/\.claude\/projects\/[^/]+\/memory\//;

export function isMemoryPath(filePath: string): boolean {
  return MEMORY_PATH_PATTERN.test(resolve(filePath));
}
