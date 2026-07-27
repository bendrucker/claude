# Things 3 Authentication

```bash
# One-time setup: store token in keychain
AUTH_TOKEN=$(op item get 5iene5gxngiqrxknafb7gslm4q --fields label=credential --reveal)
security add-generic-password -a "$USER" -s "things-auth-token" -w "$AUTH_TOKEN" -U
unset AUTH_TOKEN

# Usage: retrieve from keychain (no prompts, works for launchd)
AUTH_TOKEN=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)
```

Keychain reads work unattended (no approval prompts, launchd-safe). The 1Password item `5iene5gxngiqrxknafb7gslm4q` is the source of truth. To update a stale token, delete the keychain entry and re-run setup:

```bash
security delete-generic-password -a "$USER" -s "things-auth-token"
```
