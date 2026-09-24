const id = createUser(db, "ada");
expect(getUser(db, id)?.name).toBe("ada");
