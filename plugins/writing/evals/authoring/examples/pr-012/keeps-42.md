---
fail: [keeps-42]
---
<out>Title: require datadog provider >= 3.9

## What
* Requires version [`3.9.0`](https://github.com/DataDog/terraform-provider-datadog/blob/master/CHANGELOG.md#390-march-9-2022) or greater of the Datadog provider

## Why
* An earlier change implicitly requires this by setting attributes that were only introduced in 3.9.0. This explicitly sets that requirement earlier on, causing configurations using older versions to fail at `terraform init` rather than encounter "unexpected attribute" errors at runtime.
</out>
