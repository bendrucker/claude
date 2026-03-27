import { $ } from "bun";

async function ping(): Promise<void> {
  await $`osascript -l JavaScript -e 'Application("Things3").version()'`.quiet();
}

export async function ensureThingsRunning(): Promise<void> {
  try {
    await ping();
  } catch {
    await Bun.sleep(2000);
    try {
      await ping();
    } catch (error) {
      throw new Error(
        `Things 3 is not available. Ensure it is installed and can be launched. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}
