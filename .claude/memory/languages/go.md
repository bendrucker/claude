# Go

- Use the latest Go language features within the version given in `go.mod`.

## Tests

Write table-style tests.

```go
package mypackage_test

import (
  "testing"
)

func TestMyFunction(t *testing.T) {
  for _, tc := range []struct {
    name     string
    input    string
    expected string
  }{
    {
      name:     "case1",
      input:    "input1",
      expected: "expected1",
    },
    {
      name:     "case2",
      input:    "input2",
      expected: "expected2",
    },
  } {
    t.Run(tc.name, func(t *testing.T) {
      result := MyFunction(tc.input)
      
      if result != tc.expected {
        t.Errorf("expected %s, got %s", tc.expected, result)
      }
    })
  }
}
```

### Rules

- A `name` field should be included in test cases to describe the test. Go will automatically format this with underscores to a valid test name so use space delimited words and Go will handle it.
- The `name` of a test **shall not** be passed to any function except `t.Run` or in the message part of `Errorf`. Test names should **never** be used to control test behavior.
