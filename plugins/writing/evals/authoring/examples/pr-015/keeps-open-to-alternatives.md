---
fail: [keeps-open-to-alternatives]
---
<out>Title: Add `ProtocolVersionError` type with client/server versions

This adds a `ProtocolVersionError` error type that is returned when encountering a client/server plugin API mismatch. This `error` exposes the `ClientVersions` and `ServerVersions`. The error string remains the same as it is currently.

This provides a mechanism for plugin authors to implement custom messaging around version mismatches. For example, if the plugin server version is greater than the offered client versions, you could tell the user "upgrade the client or downgrade the plugin."

See https://github.com/terraform-linters/tflint/issues/1341 for an example of the issues that come up when protocol iterations are semi-frequent. And https://github.com/terraform-linters/tflint/blob/bf80af29756b3de976871360d3574879f5eddec0/plugin/discovery.go#L137-L156 for a hack that was put in place to try to wrap this error.
</out>
