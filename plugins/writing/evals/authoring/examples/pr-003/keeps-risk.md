---
fail: [keeps-risk]
---

<out>
pass `genericclioptions.IOStreams` as value

Passes `IOStreams` around by value instead of by pointer. `IOStreams` is a struct of interfaces, so a value copy still shares the same underlying reader and writer as the caller. `genericclioptions`'s own test helpers, like `NewTestIOStreams`, already return an `IOStreams` value instead of a pointer, so this matches how the package expects it to be used elsewhere.

Streams flow through `cmd/forward.go`, `internal/command`, and `internal/forwarder` today, so this cleans up the pointer plumbing across all three packages without touching any exported behavior or function signatures beyond the streams parameter itself.

See the `IOStreams` docs on pkg.go.dev, and this go.dev/play snippet for the general pointer-vs-value distinction on struct fields: https://go.dev/play/p/Y_HaqaOcm8u
</out>
