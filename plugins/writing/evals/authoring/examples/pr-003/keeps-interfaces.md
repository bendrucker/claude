---
fail: [keeps-interfaces]
---

<out>
pass `genericclioptions.IOStreams` as value

Passes `IOStreams` around by value instead of by pointer, matching how `genericclioptions`'s own test helpers, like `NewTestIOStreams`, already return it.

Passing a pointer risks the opposite problem: a function that only needs to read or write through the streams could reassign `streams.Out` itself and leak that change back to the caller. A value keeps callers from reconfiguring each other's stream setup.

Streams flow through `cmd/forward.go`, `internal/command`, and `internal/forwarder` today, so this cleans up the pointer plumbing across all three packages without touching any exported behavior or function signatures beyond the streams parameter itself.

See the `IOStreams` docs on pkg.go.dev, and this go.dev/play snippet for the general pointer-vs-value distinction on struct fields: https://go.dev/play/p/Y_HaqaOcm8u
</out>
