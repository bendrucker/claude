# Bun Shell

`Bun.$` is a tagged template for shell execution. Interpolated values are auto-escaped.

```ts
import { $ } from "bun";
const text = await $`echo hello`.text();
```

## Response Methods

Extract output in different formats:

```ts
// As string
const text = await $`echo hello`.text();

// As JSON
const data = await $`echo '{"key":"value"}'`.json();

// As array of lines
const lines = await $`ls`.lines();

// As Blob
const blob = await $`cat file.txt`.blob();
```

## Error Handling

By default, `$` throws on non-zero exit codes. Use `.nothrow()` to handle failures manually:

```ts
const result = await $`false`.nothrow();
if (result.exitCode !== 0) {
  console.error("Command failed:", result.stderr.toString());
}
```

Combine with `.quiet()` to suppress stdout/stderr:

```ts
const { exitCode, stdout } = await $`cmd`.nothrow().quiet();
```

## Piping

Pipe between commands:

```ts
const text = await $`echo hello | tr a-z A-Z`.text();
console.log(text); // "HELLO"
```

## Redirection

Redirect output to files:

```ts
await $`echo hello > /tmp/output.txt`;
await $`echo world >> /tmp/output.txt`; // append
```

Redirect stderr:

```ts
await $`cmd 2> /tmp/errors.txt`;
await $`cmd 2>&1`; // stderr to stdout
```

## Configuration

Per-command configuration:

```ts
await $`pwd`.cwd("/tmp");
await $`echo $FOO`.env({ ...process.env, FOO: "bar" });
```

Bypass escaping with `{ raw: "..." }` when shell expansion is needed.
