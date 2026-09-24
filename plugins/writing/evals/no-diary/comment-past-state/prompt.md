no-diary this comment.

```ts
// This used to be a giant switch statement that duplicated the parser logic in
// three places, which was a nightmare to keep in sync. Ben asked me to pull it
// out during review of #412, so now it delegates to parseToken. See ENG-1183
// and the Acme Corp incident for background.
function read(input: string) {
```
