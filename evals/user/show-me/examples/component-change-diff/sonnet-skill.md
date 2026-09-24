Both charts are dumb — they just render whatever `data` they're handed. The single choke point is one hook call in the dashboard page.

**Component tree:**
```
Dashboard (src/pages/Dashboard.tsx)
├── Header
├── RevenueChart   ← props: any, just renders data={revenue}
├── SignupsChart   ← props: any, just renders data={signups}
└── RecentOrders
```

**Where the 30-day lock-in lives today** — `src/pages/Dashboard.tsx:8`:
```tsx
const { revenue, signups } = useMetrics({ days: 30 });
```
`useMetrics({ days })` (`src/hooks/useMetrics.ts:1`) is the only place a date range exists in the codebase — there's no context, URL param, or store carrying it anywhere else.

**Diff — where the picker goes:**
```diff
 Dashboard (src/pages/Dashboard.tsx)
+  const [range, setRange] = useState({ days: 30 })
+  <DateRangePicker value={range} onChange={setRange} />
   <Header />
-  const { revenue, signups } = useMetrics({ days: 30 });
+  const { revenue, signups } = useMetrics(range);
   <RevenueChart data={revenue} />
   <SignupsChart data={signups} />
   <RecentOrders />
```

Because both charts only ever receive already-filtered `data` props, adding the picker's state at the `Dashboard` level and feeding it into the existing `useMetrics(range)` call is the only wiring needed — no changes to `RevenueChart`/`SignupsChart` themselves, and no context/store to introduce.
