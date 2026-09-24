createUser(db, "ada");
expect(getUser(db, 1)).toBeDefined();
expect(db.query("SELECT name FROM users").get()).toEqual({ name: "ada" });
