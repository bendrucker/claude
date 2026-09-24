---
fail: [only-billing, short-close]
---
Here's how the settings page is put together — it's a scaffold (most leaves are stubs), but the structure is real:

```tsx fragment
<SettingsPage> (src/routes/settings.tsx)
  useAccount()                          — src/hooks/useAccount.ts, stub: hardcoded account + no-op save
  <SettingsNav active="profile">        — src/components/SettingsNav.tsx (empty stub, no tabs wired up)
  <ProfileForm account onSave>          — src/components/ProfileForm.tsx
    <AvatarPicker url>                    — src/components/AvatarPicker.tsx (stub)
    <TextField> × 2 (Name, Email)         — src/components/TextField.tsx
    <button type="submit">
  <BillingPanel plan>                   — src/components/BillingPanel.tsx, only if account.plan !== "free"
    <InvoiceList>                          — src/components/InvoiceList.tsx (stub)
  <DangerZone accountId>                — src/components/DangerZone.tsx
    <ConfirmDialog title action>          — src/components/ConfirmDialog.tsx (stub)
```

Notes:
- Three branches hang off `SettingsPage`: `ProfileForm`, `BillingPanel` (conditional on plan), and `DangerZone`, each one level deeper into a stub child.
- `SettingsNav` takes an `active` prop suggesting tabbed navigation, but it currently renders an empty `<div />` — no tab/sub-panel switching is actually implemented.
- Nearly every leaf (`SettingsNav`, `AvatarPicker`, `InvoiceList`, `ConfirmDialog`) is an unimplemented stub — this looks like scaffolded structure rather than a finished feature.
