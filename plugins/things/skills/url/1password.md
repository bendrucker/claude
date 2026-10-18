# Things 3 Authentication

The auth token lives in the keychain under service `things-auth-token`, which reads unattended (launchd-safe). Store it once from 1Password:

```bash
security add-generic-password -a "$USER" -s things-auth-token -U \
  -w "$(op item get <item> --fields label=credential --reveal)"
```

`-U` overwrites a stale token. Read it back with:

```bash
security find-generic-password -a "$USER" -s things-auth-token -w
```
