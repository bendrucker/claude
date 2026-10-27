import { expect, test } from "bun:test";
import { injectionBlocker } from "./heap-peak";

test.each<{ name: string; binary: string; codesign: string; expected: string | undefined }>([
  { name: "SIP-protected path", binary: "/bin/sh", codesign: "", expected: "SIP-protected" },
  {
    name: "hardened runtime",
    binary: "/opt/tool",
    codesign: "CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+0",
    expected: "hardened runtime",
  },
  {
    name: "ad hoc signature",
    binary: "/opt/tool",
    codesign: "CodeDirectory v=20400 size=381 flags=0x20002(adhoc,linker-signed) hashes=9+0",
    expected: undefined,
  },
])("$name", ({ binary, codesign, expected }) => {
  const blocker = injectionBlocker(binary, codesign);
  if (expected === undefined) expect(blocker).toBeUndefined();
  else expect(blocker).toContain(expected);
});
