---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?(?:inject|parameteri[sz]|placeholder|\$1|\$2)'
flags: i
match: contains
---
The comments flag that `searchCustomers` interpolates `term` into the SQL, so the search box is a SQL injection.
