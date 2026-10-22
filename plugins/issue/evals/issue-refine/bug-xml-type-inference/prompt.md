Refine this into an issue:

Reading a directory of XML exports with the XML reader extension infers the wrong column type when one file has an empty element where the others have a number. `<Amount/>` in one file makes the whole `Amount` column VARCHAR, and every downstream query that sums it fails with a conversion error. Our exports hit this whenever a record has no amount.

What I found:
- Minimal repro: two files, `a.xml` with `<Row><Amount>12.5</Amount></Row>` and `b.xml` with `<Row><Amount/></Row>`. `read_xml('*.xml')` types Amount as VARCHAR. Either file alone types it DOUBLE (or as all-NULL for b.xml).
- The extension's schema inference treats an empty element as an empty string, and the merge across files widens DOUBLE + VARCHAR to VARCHAR.
- Upstream already merged a cardinality-merge fix in their PR #75, which touched the same merge function. No upstream issue exists for the empty-element case.
- I built a patch that treats an empty element as unknown type during inference, so the merge takes the other file's type. It passes the full upstream test suite. It's on branch `xml-type-fidelity` in a worktree on my Studio, not pushed yet.
- Repro output and traces are in tmp/xml-repro/ and tmp/climb/noise-3/traces/ in my checkout.
- I compared row counts before and after with compare.ts from my hill-climb skill: no rows lost.
- Workaround until upstream ships: pass an explicit `columns={'Amount': 'DOUBLE'}` to read_xml in our loader.

Files:
- loaders/xml_loader.py (load_exports calls read_xml over the export glob with no column types)

Upstream:
- XML reader extension repository: https://github.com/example/xml-reader
- Upstream PR #75, cardinality merge across files: https://github.com/example/xml-reader/pull/75
