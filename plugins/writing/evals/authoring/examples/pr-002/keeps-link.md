---
fail: [keeps-link]
---
<out>
Title: executor: set machine image [semver:patch]

CircleCI's default machine image currently fails to pull code from GitHub, since it's still on an OpenSSH build old enough that GitHub's RSA/SHA-1 host key is no longer accepted.
</out>
