<out>
pass `genericclioptions.IOStreams` as value

Passes `IOStreams` around by value instead of by pointer. `IOStreams` is a struct of interfaces:

https://pkg.go.dev/k8s.io/cli-runtime/pkg/genericclioptions#IOStreams

A struct of interfaces can generally be passed by value: the fields are already references, so a value copy still shares the same underlying reader and writer. `genericclioptions`'s own test helpers, like `NewTestIOStreams`, already return an `IOStreams` value instead of a pointer, so this matches how the package expects it to be used elsewhere.

Passing a pointer instead risks the opposite problem: a function that only needs to read or write through the streams could reassign `streams.Out` itself and leak that change back to the caller. A value keeps callers from reconfiguring each other's stream setup.

See this go.dev/play snippet for the general pointer-vs-value distinction on struct fields: https://go.dev/play/p/Y_HaqaOcm8u
</out>
