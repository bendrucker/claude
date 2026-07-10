# File I/O

## Bun.file()

`Bun.file()` returns a `BunFile` representing a file on disk. It does not read the file immediately:

```ts
const file = Bun.file("path.txt");
const content = await file.text();
```

Common methods:

```ts
// Read as text
const text = await Bun.file("file.txt").text();

// Read as JSON
const data = await Bun.file("data.json").json();

// Read as ArrayBuffer
const buffer = await Bun.file("binary.dat").arrayBuffer();

// Read as stream
const stream = Bun.file("large.txt").stream();
```

Check if a file exists:

```ts
const file = Bun.file("path.txt");
const exists = await file.exists();
```

MIME type detection:

```ts
const file = Bun.file("image.png");
console.log(file.type); // "image/png"
```

## Bun.write()

`Bun.write()` writes content to a file, creating it if absent:

```ts
await Bun.write("output.txt", "content");
```

Write JSON:

```ts
await Bun.write("data.json", JSON.stringify(data, null, 2));
```

Write from a stream or Response:

```ts
const response = await fetch("https://example.com/data.json");
await Bun.write("data.json", response);
```

Write to stdout or stderr:

```ts
await Bun.write(Bun.stdout, "message\n");
await Bun.write(Bun.stderr, "error\n");
```

## Streaming

For large files, stream instead of loading into memory:

```ts
const file = Bun.file("large.txt");
const stream = file.stream();

for await (const chunk of stream) {
  // Process chunk
}
```
