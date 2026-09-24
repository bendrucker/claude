`parseManifest` throws `TypeError: manifest is missing a version` when the version field is absent. That's the behavior we want, it just isn't tested. Add a test that pins it.
