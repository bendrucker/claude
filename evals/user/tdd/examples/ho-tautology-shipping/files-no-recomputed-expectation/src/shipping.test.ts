expect(shippingCost(1, 7500)).toBe(0);
expect(shippingCost(2, 1000)).toBe(BASE_CENTS + 2 * PER_KG_CENTS);
