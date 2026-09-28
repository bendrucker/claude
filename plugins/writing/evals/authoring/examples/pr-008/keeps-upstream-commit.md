---
fail: [keeps-upstream-commit]
---
<out>Title: Replace `go get` with `go install`, pin version

Uses `go install` to install https://github.com/hashicorp/terraform-config-inspect. Pins to the last meaningful revision before the commit that requires `go@1.18`. The changes introduced there are only relevant to the Go API and not CLI usage. Restoring `latest` as the version target will be a breaking change, as it will require `go@1.18`.

Closes #7, Closes #6
</out>
