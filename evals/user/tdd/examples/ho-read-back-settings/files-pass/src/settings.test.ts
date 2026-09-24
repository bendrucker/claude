const store = openSettings(path);
store.set("a", "1");
store.remove("a");
expect(openSettings(path).get("a")).toBeUndefined();
