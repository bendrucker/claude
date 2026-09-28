---
fail: [keeps-attribute-error]
---
<out>Title: require datadog provider >= 3.9

## What
* Requires version [`3.9.0`](https://github.com/DataDog/terraform-provider-datadog/blob/master/CHANGELOG.md#390-march-9-2022) or greater of the Datadog provider

## Why
* #42 implicitly requires this by setting attributes that were only introduced in 3.9.0. This explicitly sets that requirement earlier on, causing configurations using older versions to fail cleanly at `terraform init` instead of failing later, mid-apply.

## References
* #42 added the new attributes
</out>
