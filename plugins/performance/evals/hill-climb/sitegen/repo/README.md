# sitegen

Builds the docs site from `content/` into `public/`.

```sh
go build -o bin/sitegen . && bin/sitegen
```

`.sitegen-cache/` keeps resized images and fetched remote includes between builds, keyed by content hash and URL. Delete it to force a full rebuild. The `docs-preview` CI job starts from a fresh checkout without it and publishes `public/` as the PR's preview.

`content/` holds 2,310 pages and 1,420 screenshots. 212 pages pull a shared snippet through a `{{< remote "<url>" >}}` include.
