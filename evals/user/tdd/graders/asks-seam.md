---
type: llm
---
The reply stops before writing tests and asks the user to confirm the public interface or seam the tests should target. Asking where a new input enters the public API counts, such as whether a new setting becomes a parameter of an existing function or is read from configuration, and so does proposing a function to test and asking the user to confirm it. Fail a reply that only asks about behavior details, such as status codes or formats, without any question about which interface the tests go through.
