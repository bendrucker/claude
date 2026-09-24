const get = async () => ({ temp: 21 });
expect(await summary("Oslo", get)).toBe("Oslo: 21C");
