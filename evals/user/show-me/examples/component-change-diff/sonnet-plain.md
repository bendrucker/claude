---
fail: [diff-block, tree-diff]
---
Found it — good news is this is a simple, centralized fix, not a per-chart duplication problem.

**Where the 30-day range comes from**

`src/pages/Dashboard.tsx:8`
```tsx
const { revenue, signups } = useMetrics({ days: 30 });
```

Both `RevenueChart` and `SignupsChart` (`src/components/RevenueChart.tsx`, `src/components/SignupsChart.tsx`) are pure stubs — they just render whatever `data` prop they're given and have no date logic of their own. So the "stuck on 30 days" behavior isn't duplicated per chart; it's one hardcoded value at a single call site that feeds both.

`src/hooks/useMetrics.ts` already accepts an arbitrary `{ days: number }` range and passes it straight through — it's already shaped to take a variable range, nothing to refactor there.

**Where a date-range picker would go**

Right in `Dashboard.tsx`, above the `useMetrics` call:

```tsx
export function Dashboard() {
  const [range, setRange] = useState({ days: 30 });   // ← replace the hardcoded literal
  const { revenue, signups } = useMetrics(range);

  return (
    <div className="dashboard">
      <Header title="Overview" />
      <DateRangePicker value={range} onChange={setRange} />  {/* ← new component, lives here */}
      <section className="charts">
        <RevenueChart data={revenue} />
        <SignupsChart data={signups} />
      </section>
      <RecentOrders limit={10} />
    </div>
  );
}
```

That single `useState` in `Dashboard.tsx` is enough to sync both charts — no Context/Redux/URL-param layer needed, since both charts already receive data as props from one shared `useMetrics` call. There's no existing date-range picker anywhere in the repo (checked for `DateRangePicker`, `DateRange`, etc.) or any state-management library, so the picker component would need to be built from scratch.

No edits made, per your request.
