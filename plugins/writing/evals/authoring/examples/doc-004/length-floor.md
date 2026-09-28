---
fail: [length-floor, keeps-leader, keeps-optional-exclusion, keeps-constructors]
---
<out>
# packhorse

API for updating multiple packages.

## Installing

```bash
$ npm install packhorse
```

## API

### `packhorse`

##### `packhorse.load(packages)` -> `Pack`

Accepts an `Array` of package configuration and loads them into the `Pack`. A package can be a:

* `path` to a package (string)
* an object with:
  * `path` (string)
  * `optional` (boolean)

The first package will be considered 
</out>
