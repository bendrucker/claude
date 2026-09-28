---
fail: [keeps-go118]
---
<out>Title: Replace `go get` with `go install`, pin version

Uses `go install` to install https://github.com/hashicorp/terraform-config-inspect. Pins to the last meaningful revision before https://github.com/hashicorp/terraform-config-inspect/commit/81db043ad408976450c4af995dbe69ae70b26c82, which requires a newer Go toolchain. The changes introduced there are only relevant to the Go API and not CLI usage. Restoring `latest` as the version target will be a breaking change.

Closes #7, Closes #6
</out>
