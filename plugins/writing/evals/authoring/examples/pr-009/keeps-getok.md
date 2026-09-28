---
fail: [keeps-getok]
---
<out>
Title: `user`: handle unknown superuser passwords

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

Upon further investigation, this error is returned from `CustomizeDiff`. This hook runs before a plan is rendered. This means that on first run, before the `Create` method for `random_password` has run, the value for `result` is not yet known, though the schema helper reports the field as set regardless. Any plan time inspection can only occur when the new value is known at plan time. 

While I didn't set up real cluster credentials to run the acceptance tests to success for this, I did execute them to ensure that the added test case fails with the original error and proceeds to a connection error with the fix.
</out>
