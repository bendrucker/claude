---
fail: []
---
<out>
Title: executor: set machine image [semver:patch]

https://discuss.circleci.com/t/discussion-and-resolution-for-error-youre-using-an-rsa-key-with-sha-1-which-is-no-longer-allowed/42572

CircleCI's default machine image currently fails to pull code from GitHub. They recommend using a newer OpenSSH.

I'd prefer `machine: true` to express a mutable target of "latest" rather than the actual behavior which seems to be using a heavily outdated image.
</out>
