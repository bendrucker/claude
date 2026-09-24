---
fail: []
---
<rewrite>
The null check before the token lookup is redundant, since the caller already guards it. The catch block swallows the error, so a failed refresh looks like success. I addressed the token refresh and retry comments.
</rewrite>
