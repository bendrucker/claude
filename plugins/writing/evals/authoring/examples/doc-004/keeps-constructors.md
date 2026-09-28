---
fail: [keeps-constructors]
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

The first package will be considered the "leader" for `pack.get` calls. Packages where `optional` is `true` will be excluded if they are not found.


<hr>

### `Pack`

A `Pack` controls batch operations across many `Package` instances.

##### `get(key)` -> `any`

Gets data from the first package stored at `key`. 

##### `set(key [, value])` -> `pack`

Sets a value on all packages in the pack. `set` can be called with a key value pair or an object.

##### `read()` -> `promise(pack)`

Reads in data for all packages in the pack. Returns a promise that resolves when all packages have been read.

##### `write()` -> `promise(pack)`

Updates data for all packages in the pack. Returns a promise that resolves when all packages have been written.

<hr>

### `Package`

##### `get(key)` -> `any`

Gets data from the package stored at `key`. 

##### `set(key [, value])` -> `pack`

Sets a value on the package data. `set` can be called with a key value pair or an object.

##### `read()` -> `promise(pkg)`

Reads in data for the package. Returns a promise that resolves the package when the data has been read.

##### `write()` -> `promise(pkg)`

Writes data for the package. Returns a promise that resolves the package when the data has been written.
</out>
