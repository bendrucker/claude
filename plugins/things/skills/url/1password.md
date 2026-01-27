# Things 3 Authentication

## Quick Start

```bash
# One-time setup: Store token in keychain
AUTH_TOKEN=$(op item get 5iene5gxngiqrxknafb7gslm4q --fields label=credential --reveal)
security add-generic-password -a "$USER" -s "things-auth-token" -w "$AUTH_TOKEN" -U
unset AUTH_TOKEN

# Usage: Retrieve from keychain (no prompts, works for launchd)
AUTH_TOKEN=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)
```

## Why Keychain?

- **No approval prompts**: Works unattended for background processes
- **Secure**: Token stored in macOS Keychain, not filesystem
- **1Password source of truth**: Manual updates sync from 1Password item `5iene5gxngiqrxknafb7gslm4q`

## Update Token

```bash
security delete-generic-password -a "$USER" -s "things-auth-token"
# Then re-run setup
```
