---
type: regex
pattern: '^(?=[^\n]*(?:profil|7\.1|6\.8|working copy|laptop|local))(?=[^\n]*(?:warm|cache[ds]?\b|cache (hit|was|is)|populated|already))(?=[^\n]*(?:cold|empty|fresh|without (the |a )?cache|\bCI\b|64|miss))'
flags: im
match: contains
---
The profile ran 7.1s in the maintainer's working copy, where `.sitegen-cache/` already holds every resized image and remote include. The metric is the 64.2s CI build that starts without the cache, so the profile never sees the resizing or the fetches.
