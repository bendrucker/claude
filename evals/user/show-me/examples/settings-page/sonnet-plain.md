---
fail: [only-billing, short-close]
---
Here's the settings page architecture, root to leaf:

```
SettingsPage (src/routes/settings.tsx:7)
├─ uses hook: useAccount() → { account, save }  (src/hooks/useAccount.ts:1)
├─ SettingsNav (src/components/SettingsNav.tsx:1)          props: active="profile"
├─ ProfileForm (src/components/ProfileForm.tsx:4)          props: account, onSave
│  ├─ AvatarPicker (src/components/AvatarPicker.tsx:1)      props: url
│  └─ TextField ×2 (src/components/TextField.tsx:1)         props: label, value
├─ BillingPanel [if plan !== "free"] (src/components/BillingPanel.tsx:3)  props: plan
│  └─ InvoiceList (src/components/InvoiceList.tsx:1)         props: (none)
└─ DangerZone (src/components/DangerZone.tsx:3)             props: accountId
   └─ ConfirmDialog (src/components/ConfirmDialog.tsx:1)     props: title, action
```

**Root — `SettingsPage`** (`src/routes/settings.tsx:7-19`)
Owns the page. Pulls `{ account, save }` from `useAccount()` and lays out four sections directly inline (no dedicated `SettingsLayout` component). `BillingPanel` is the only conditional section, gated on `account.plan !== "free"` — that check lives in the page, not in `BillingPanel` itself.

**`useAccount()`** (`src/hooks/useAccount.ts:1-3`)
The single source of truth for the whole page. No context/Redux/react-query — it's currently a stub returning a hardcoded account object and a no-op async `save`.

**`SettingsNav`** (`src/components/SettingsNav.tsx`)
Gets `active="profile"`, implying it's meant to be a tab switcher, but it's currently an unimplemented stub and nothing actually switches between sections — everything just renders in one scroll.

**`ProfileForm`** (`src/components/ProfileForm.tsx:4-13`)
Receives `account` and `onSave`. Renders `AvatarPicker` (avatar URL) and two `TextField`s (name, email). Worth flagging: on submit it calls `onSave(account)` with the *original* account object, not edited values — since `TextField` doesn't wire up `onChange` yet, so edits currently wouldn't actually persist.

**`BillingPanel`** (`src/components/BillingPanel.tsx:3-10`)
Receives `plan`, renders `InvoiceList` (currently gets no props, so it has nothing to list yet).

**`DangerZone`** (`src/components/DangerZone.tsx:3-5`)
Receives `accountId`, builds an `action` URL (`/accounts/${accountId}`) and passes it plus a title into the generic `ConfirmDialog`.

**Overall state:** data flows one-directionally top-down via props from the single `useAccount()` call; the only write path back up is `onSave`. Most leaf components (`SettingsNav`, `AvatarPicker`, `TextField`, `InvoiceList`, `ConfirmDialog`) are still stub placeholders (`<div />`, unused `props: any`) — the composition/wiring is real, but the actual UI/behavior isn't built out yet.
