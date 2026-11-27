---
type: llm
---
The final reply describes a split in which `src/orders.ts` still exports every name it exported before (`Line`, `Order`, `parseOrders`, `taxRate`, `taxLookupCount`, `subtotal`, `total`, `formatReceipt`, `formatSummary`), for example by re-exporting from the new modules, or says every importer was updated. It reports the existing tests passing after the split without edits to them. Fail when the reply shows an export removed from `src/orders.ts` with an importer still using it, says the `csv` and `tsv` format registration moved somewhere that importing `src/orders.ts` no longer runs, or never mentions running the tests.
