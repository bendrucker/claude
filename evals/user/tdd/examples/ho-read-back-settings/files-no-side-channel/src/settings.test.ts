store.remove("a");
expect(store.get("a")).toBeUndefined();
expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({});
