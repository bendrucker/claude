Refine this into an issue for the xml-reader maintainers:

When `read_xml` reads several files and one has an empty element where the others have a number, schema inference types the whole column VARCHAR. `<Amount/>` in one file turns `Amount` from DOUBLE into VARCHAR for every file in the glob.

What I found:
- Minimal repro: `a.xml` holds `<Row><Amount>12.5</Amount></Row>` and `b.xml` holds `<Row><Amount/></Row>`. `SELECT typeof(Amount) FROM read_xml('*.xml')` returns VARCHAR. `a.xml` alone returns DOUBLE.
- Inference treats an empty element as an empty string, and the cross-file merge widens DOUBLE + VARCHAR to VARCHAR.
- Their PR #75 (https://github.com/example/xml-reader/pull/75) fixed cardinality merging across files in the same merge function.
- A fix that treats an empty element as unknown type during inference, so the merge takes the other file's type, passes their full test suite. I have it on a branch locally and can open a PR.

Files in their repo:
- src/xml_schema_inference.cpp (InferElementType returns VARCHAR for an element with no text)
- src/xml_schema_merge.cpp (MergeColumnTypes widens mismatched types to VARCHAR; PR #75 touched it)
- test/sql/read_xml_types.test (type inference tests)
