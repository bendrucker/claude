#!/usr/bin/env python3
"""
Patch Claude Code's macOS sandbox profile to allow com.apple.trustd Mach IPC.

Go binaries (e.g. gh CLI) need the trustd service for TLS certificate
verification on macOS. Claude Code's bundled sandbox-runtime doesn't whitelist
it, causing "x509: OSStatus -26276" TLS errors inside the sandbox.

Bug report: https://github.com/anthropics/claude-code/issues/23416
Upstream fix: https://github.com/anthropic-experimental/sandbox-runtime/pull/120

Once the upstream fix is released in a Claude Code update, this script is no
longer needed.

Adapted from: https://gist.github.com/ehsan/8c1bc6570c1c924f6ac4f8e1e58158ba

This script:
  1. Finds the active Claude Code binary
  2. Replaces the unused "com.apple.audio.systemsoundserver" mach-lookup entry
     with a "global-name-prefix com.apple.trustd" rule (matches both
     com.apple.trustd and com.apple.trustd.agent)
  3. Re-signs the binary with a Developer ID Application certificate

Run after every Claude Code update:
    python3 scripts/patch-sandbox.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

SEARCH = b'global-name "com.apple.audio.systemsoundserver"'
REPLACE = b'global-name-prefix "com.apple.trustd"          '

assert len(SEARCH) == len(REPLACE), "Search/replace length mismatch"

CANDIDATES = [
    Path.home() / ".local" / "bin" / "claude",
    Path("/opt/homebrew/bin/claude"),
    Path("/usr/local/bin/claude"),
]


def find_binary() -> Path:
    """Find the active Claude Code binary by resolving known symlink locations."""
    for candidate in CANDIDATES:
        if candidate.exists():
            target = candidate.resolve()
            if target.exists():
                return target

    locations = "\n  ".join(str(c) for c in CANDIDATES)
    sys.exit(f"Error: Claude Code binary not found at any known location:\n  {locations}")


def find_signing_identity() -> str:
    """Find a Developer ID Application certificate, falling back to ad-hoc."""
    result = subprocess.run(
        ["security", "find-identity", "-v", "-p", "codesigning"],
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        if "Developer ID Application" in line:
            # Format: "  1) HASH "Developer ID Application: Name (ID)""
            parts = line.strip().split()
            if len(parts) >= 2:
                return parts[1]
    sys.exit(
        "Error: No Developer ID Application certificate found.\n"
        "Install one from your Apple Developer account or run:\n"
        "  security find-identity -v -p codesigning"
    )


def is_already_patched(data: bytes) -> bool:
    return REPLACE in data and SEARCH not in data


def patch(binary: Path) -> None:
    print(f"Binary: {binary}")
    print(f"Size:   {binary.stat().st_size:,} bytes")

    data = binary.read_bytes()

    if is_already_patched(data):
        print("Already patched, nothing to do.")
        return

    count = data.count(SEARCH)
    if count == 0:
        sys.exit(
            "Error: search string not found in binary. "
            "The binary format may have changed — this script needs updating."
        )

    backup = binary.parent / (binary.name + ".bak")
    if not backup.exists():
        shutil.copy2(binary, backup)
        print(f"Backup: {backup}")
    else:
        print(f"Backup already exists: {backup}")

    pre_existing = data.count(REPLACE)
    patched = data.replace(SEARCH, REPLACE)
    assert len(patched) == len(data), "Binary size changed after patching"
    assert patched.count(SEARCH) == 0, "Old string still present"
    assert patched.count(REPLACE) == pre_existing + count, "Replacement count mismatch"

    binary.write_bytes(patched)
    print(f"Patched {count} occurrence(s)")

    identity = find_signing_identity()
    result = subprocess.run(
        ["codesign", "--force", "--sign", identity, str(binary)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"Error re-signing binary: {result.stderr}")
    print(f"Re-signed with Developer ID ({identity})")

    result = subprocess.run(
        ["codesign", "-v", str(binary)], capture_output=True, text=True
    )
    if result.returncode != 0:
        sys.exit(f"Error verifying signature: {result.stderr}")
    print("Signature verified OK")

    subprocess.run(["xattr", "-cr", str(binary)], check=True)
    print("Cleared quarantine attribute")

    print("Done. Restart Claude Code for the patch to take effect.")


if __name__ == "__main__":
    if sys.platform != "darwin":
        sys.exit("This patch is only needed on macOS")
    patch(find_binary())
