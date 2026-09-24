#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/pages src/components src/hooks
cat > src/pages/Dashboard.tsx <<'TSX'
import { Header } from "../components/Header";
import { RevenueChart } from "../components/RevenueChart";
import { SignupsChart } from "../components/SignupsChart";
import { RecentOrders } from "../components/RecentOrders";
import { useMetrics } from "../hooks/useMetrics";

export function Dashboard() {
  const { revenue, signups } = useMetrics({ days: 30 });
  return (
    <div className="dashboard">
      <Header title="Overview" />
      <section className="charts">
        <RevenueChart data={revenue} />
        <SignupsChart data={signups} />
      </section>
      <RecentOrders limit={10} />
    </div>
  );
}
TSX
cat > src/hooks/useMetrics.ts <<'TS'
export function useMetrics(range: { days: number }) {
  return { revenue: [] as number[], signups: [] as number[], range };
}
TS
for c in Header RevenueChart SignupsChart RecentOrders; do
  printf 'export function %s(props: any) {\n  return <div />;\n}\n' "$c" > "src/components/$c.tsx"
done
