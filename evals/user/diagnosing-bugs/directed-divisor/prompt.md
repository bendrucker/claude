`formatPrice` in src/format.ts divides by 10 instead of 100, which is why the format test fails. Make it 100 and run the tests.
