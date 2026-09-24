#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/routes src/components src/hooks
cat > src/routes/settings.tsx <<'TSX'
import { useAccount } from "../hooks/useAccount";
import { ProfileForm } from "../components/ProfileForm";
import { BillingPanel } from "../components/BillingPanel";
import { DangerZone } from "../components/DangerZone";
import { SettingsNav } from "../components/SettingsNav";

export function SettingsPage() {
  const { account, save } = useAccount();
  return (
    <div className="settings">
      <SettingsNav active="profile" />
      <main>
        <ProfileForm account={account} onSave={save} />
        {account.plan !== "free" && <BillingPanel plan={account.plan} />}
        <DangerZone accountId={account.id} />
      </main>
    </div>
  );
}
TSX
cat > src/components/ProfileForm.tsx <<'TSX'
import { AvatarPicker } from "./AvatarPicker";
import { TextField } from "./TextField";

export function ProfileForm({ account, onSave }: { account: any; onSave: (a: any) => void }) {
  return (
    <form onSubmit={() => onSave(account)}>
      <AvatarPicker url={account.avatarUrl} />
      <TextField label="Name" value={account.name} />
      <TextField label="Email" value={account.email} />
      <button type="submit">Save</button>
    </form>
  );
}
TSX
cat > src/components/BillingPanel.tsx <<'TSX'
import { InvoiceList } from "./InvoiceList";

export function BillingPanel({ plan }: { plan: string }) {
  return (
    <section>
      <h2>Billing ({plan})</h2>
      <InvoiceList />
    </section>
  );
}
TSX
cat > src/components/DangerZone.tsx <<'TSX'
import { ConfirmDialog } from "./ConfirmDialog";

export function DangerZone({ accountId }: { accountId: string }) {
  return <ConfirmDialog title="Delete account" action={`/accounts/${accountId}`} />;
}
TSX
for c in SettingsNav AvatarPicker TextField InvoiceList ConfirmDialog; do
  printf 'export function %s(props: any) {\n  return <div />;\n}\n' "$c" > "src/components/$c.tsx"
done
cat > src/hooks/useAccount.ts <<'TS'
export function useAccount() {
  return { account: { id: "a1", name: "", email: "", plan: "pro", avatarUrl: "" }, save: async (_: unknown) => {} };
}
TS
