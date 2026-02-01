# bunx

`--bun` must come **before** the executable name to force the Bun runtime instead of respecting Node shebangs:

```bash
bunx --bun tsc --noEmit
```

`-p` / `--package` specifies the package when the binary name differs:

```bash
bunx -p @angular/cli ng new my-app
```
