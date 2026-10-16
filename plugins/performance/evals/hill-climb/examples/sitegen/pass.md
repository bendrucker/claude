The profile came from the maintainer's working copy, where `.sitegen-cache/` is already warm, so it ran 7.1 s against the 64.2 s cold CI build. It never sees image resizing or remote include fetches, which are cache hits there and misses on every CI run.

Re-profile through `bench/ci-build.sh` with the cache emptied before ranking anything.

1. **Resize images in parallel across the 4 vCPUs** (`writeImage`, `resize`). Every CI build misses the cache for all 1,420 screenshots.
2. **Fetch the 212 remote includes concurrently** (`expandIncludes`, `fetch`).
3. **Template rendering** (`html/template.(*Template).Execute`, 33% warm). Rank it after the cold profile.
