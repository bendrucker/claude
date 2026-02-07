# Subprocess

## Bun.spawn

Spawn a subprocess and stream its output:

```ts
const proc = Bun.spawn(["echo", "hello"]);
const text = await new Response(proc.stdout).text();
console.log(text); // "hello\n"
```

Stdin, stdout, and stderr are `ReadableStream` or `WritableStream` depending on the option:

```ts
const proc = Bun.spawn(["cat"], {
  stdin: "pipe",
  stdout: "pipe",
});

const writer = proc.stdin.getWriter();
writer.write(new TextEncoder().encode("hello\n"));
writer.close();

const output = await new Response(proc.stdout).text();
```

Set environment variables and working directory:

```ts
const proc = Bun.spawn(["pwd"], {
  cwd: "/tmp",
  env: { ...process.env, FOO: "bar" },
});
```

Check exit code:

```ts
const proc = Bun.spawn(["false"]);
await proc.exited;
console.log(proc.exitCode); // 1
```

## Bun.spawnSync

For synchronous execution, use `Bun.spawnSync`:

```ts
const result = Bun.spawnSync(["echo", "hello"]);
console.log(result.stdout.toString()); // "hello\n"
console.log(result.exitCode); // 0
```

## Error Handling

`Bun.spawn` does not throw on non-zero exit codes. Check `exitCode` explicitly:

```ts
const proc = Bun.spawn(["false"]);
await proc.exited;
if (proc.exitCode !== 0) {
  throw new Error(`Command failed with exit code ${proc.exitCode}`);
}
```

For `spawnSync`, check the returned `exitCode`:

```ts
const result = Bun.spawnSync(["false"]);
if (result.exitCode !== 0) {
  throw new Error(`Command failed: ${result.stderr.toString()}`);
}
```
