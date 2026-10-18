| Rank | Candidate | Targets |
| --- | --- | ---: |
| 1 | Decode each line into a typed struct in `decodeRecord` instead of `map[string]any` | `encoding/json.Unmarshal` 11.00% |
| 2 | Sort each group once instead of `sort.Slice` after every append | `sort.Slice` 10.00% |
| 3 | Build rows in `renderRow` with `strconv.AppendFloat` into a reused buffer | `fmt.Sprintf` under `renderRow` 8% |
| 4 | Key the group map in `groupKey` with a struct | `fmt.Sprintf` under `groupKey` 6% |

- Overlapping decompression with parsing on a goroutine is set aside: on 1 vCPU there is no second core.
