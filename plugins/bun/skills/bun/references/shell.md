# Bun Shell

`Bun.$` is a tagged template for shell execution. Interpolated values are auto-escaped.

```ts
import { $ } from "bun";
const text = await $`echo hello`.text();
```

Use `.nothrow()` to suppress exceptions on non-zero exit codes:

```ts
const { exitCode, stdout } = await $`cmd`.nothrow().quiet();
```

Per-command configuration:

```ts
await $`pwd`.cwd("/tmp");
await $`echo $FOO`.env({ ...process.env, FOO: "bar" });
```

Bypass escaping with `{ raw: "..." }` when shell expansion is needed.
