---
fail: [keeps-message-unchanged]
---
<out>Title: Add `ProtocolVersionError` type with client/server versions

This adds a `ProtocolVersionError` error type that is returned when encountering a client/server plugin API mismatch. This `error` exposes the `ClientVersions` and `ServerVersions`.

This provides a mechanism for plugin authors to implement custom messaging around version mismatches. For example, if the plugin server version is greater than the offered client versions, you could tell the user "upgrade the client or downgrade the plugin."

See https://github.com/terraform-linters/tflint/issues/1341 for an example of the issues that come up when protocol iterations are semi-frequent.

Since the code is so simple I figured I'd offer this. Happy to work on other approaches as well.
</out>
