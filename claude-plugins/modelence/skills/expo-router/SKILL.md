---
name: expo-router
description: Expo Router rules for Modelence mobile apps — URL and group segment semantics, the canonical tabs layout, and the pre-completion checklist. Use before creating, moving, renaming, or linking any screen under mobile/app/.
---

# Expo Router rules (Modelence mobile)

Violations of these rules cause "Unmatched Route" errors that type-checking cannot catch.

## URL rules

- `(name)` folder segments are **groups** — they are stripped from the URL. `app/(tabs)/portfolio.tsx` is reachable at `/portfolio`, never `/(tabs)/portfolio` or `/tabs/portfolio`.
- `index.tsx` inside any folder represents that folder's own URL. `app/(tabs)/index.tsx` resolves to `/`.
- **Exactly one file may resolve to `/`.** If you add `(group)/index.tsx` as the default screen, you MUST delete `app/index.tsx`. Two files resolving to the same route is undefined behavior.
- Never redirect to a screen's basename. Derive `href` from the file path with groups stripped: `app/(tabs)/markets.tsx` → `href="/markets"`, `app/(tabs)/index.tsx` → `href="/"`.

## Canonical tabs-without-auth structure

When the app does not require auth gating, the correct file layout is:

```
mobile/app/
├── _layout.tsx        # Slot + providers — NO index.tsx at this level
└── (tabs)/
    ├── _layout.tsx    # <Tabs />
    ├── index.tsx      # default tab, URL = "/"
    └── <screen>.tsx   # other tabs, URL = "/<screen>"
```

Do NOT create `app/index.tsx` alongside `(tabs)/index.tsx`. The `(tabs)/index.tsx` already owns `/`.

## Pre-completion checklist for mobile changes

Before reporting mobile work as done, verify ALL of the following:

1. Every `<Redirect href="...">` and `router.push("...")` literal maps to a real file under `mobile/app/` with groups stripped.
2. Exactly one file resolves to `/` across all of `app/` and its group subdirectories.
3. Run `npx tsc --noEmit` inside `mobile/` and fix all errors.
4. TypeScript passing says nothing about Expo Router's route graph — state explicitly that runtime verification requires opening the app in the mobile preview.
