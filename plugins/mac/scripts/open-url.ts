#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to open for Launch Services, which the command sandbox blocks

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateScheme(url: string, scheme: string): ValidationResult {
  const prefix = `${scheme}://`;
  if (!url.startsWith(prefix)) {
    return { valid: false, error: `URL must start with ${prefix}, got: ${url}` };
  }
  return { valid: true };
}

if (import.meta.main) {
  const { cli } = await import("cleye");

  const argv = cli({
    name: "open-url",
    parameters: ["<scheme>", "<url>"],
  });

  const scheme = argv._.scheme;
  const url = argv._.url;

  const result = validateScheme(url, scheme);
  if (!result.valid) {
    console.error(result.error);
    process.exit(1);
  }

  const flags = argv._.slice(2);
  const proc = Bun.spawn(["open", ...flags, url], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
