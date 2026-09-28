---
fail: [keeps-unknown-value]
---
<out>
Title: `user`: gate the superuser password check on readiness

Currently, it's not possible to define configuration like this:

```tf
resource "redshift_user" "terraform" {
  name      = "terraform"
  superuser = true
  password  = random_password.terraform.result
}

resource "random_password" "terraform" {
  length      = 64
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
}
```

Given this configuration, the provider returns an error:

```
Users that are superusers must define a password.
```

Upon further investigation, this error is returned from `CustomizeDiff`, which runs before a plan is rendered.

`GetOk` will still return `_, true`, because some value is set. Any plan time inspection can only occur once a value is present.

While I didn't set up real cluster credentials to run the acceptance tests to success for this, I did execute them to ensure that the added test case fails with the original error and proceeds to a connection error with the fix.
</out>
