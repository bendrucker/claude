---
fail: [keeps-version]
---
<out>Title: require a newer datadog provider

## What
* Requires a newer release of the Datadog provider, per the [changelog](https://github.com/DataDog/terraform-provider-datadog/blob/master/CHANGELOG.md#390-march-9-2022)

## Why
* #42 implicitly requires this by setting attributes that were only introduced in that release. This explicitly sets that requirement earlier on, causing configurations using older versions to fail at `terraform init` rather than encounter "unexpected attribute" errors at runtime.

## References
* #42 added the new attributes
</out>
