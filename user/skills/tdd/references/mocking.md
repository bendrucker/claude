# Substitute Adapters

A test double is an adapter: a second concrete thing satisfying an interface at a seam. Add one only where the seam is already real.

## Real Seams

A seam is real when something varies across it. One adapter means a hypothetical seam, two mean a real one. A test double is not the second adapter.

Two things make a seam real:

- **Production varies.** Two payment providers, an in-memory store in development and Postgres in production, a real clock and a simulated one.
- **The other side sits outside the process.** Network calls, the clock, randomness, the file system. Prefer a real test database and a temp directory where either is practical, and substitute the rest.

Everything the process owns keeps its real implementation: your own modules, internal collaborators, anything you can change.

## Shaping the Interface

#### Pass Adapters In

Take the dependency as a parameter rather than constructing it inside.

```typescript
// The seam is at the parameter
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}
```

```typescript
// No seam: the implementation is wired in
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

```go
// The caller declares the interface it needs
type Charger interface {
	Charge(cents int64) error
}

func ProcessPayment(order Order, c Charger) error {
	return c.Charge(order.Total)
}
```

Go declares the interface on the consumer side, so `Charger` lives where it is used rather than being exported by the payment package. The seam stays as wide as this one caller needs, and the provider never depends on it.

#### One Function per Operation

Give each external operation its own function rather than one generic caller that branches on its arguments.

```typescript
// Each operation carries its own interface
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
};
```

```typescript
// One interface for every operation, so every adapter reimplements the routing
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/tdd/mocking.md` at `6654f6b`, MIT.
