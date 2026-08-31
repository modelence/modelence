---
name: mobile-setup
description: Add, repair, or debug an Expo (React Native) mobile app in a Modelence project — scaffolding from the official template, the MODELENCE_SITE_URL backend config, dependency pinning, root postinstall wiring, and the app identifier (Android package / iOS bundle id) rules. Use when the user asks to create, add, or set up a mobile app, when mobile/ dependencies are missing or mismatched, when changing the app's package name or bundle id, or when the mobile app fails at startup with "Failed to fetch" / "Network request failed" from modelence/dist.
---

# Modelence mobile setup (Expo)

Expo (React Native) under `mobile/` is the only supported way to add a mobile app to a
Modelence project. Do NOT propose a PWA, "add to home screen", a mobile-web alternative,
or any non-Expo path, and do not ask the user which approach to take.

Once the app exists, read the `expo-router` skill before creating, moving, renaming, or
linking any screen under `mobile/app/`.

## Step 1 — scaffold from the template (only if `mobile/` is missing)

Check whether `mobile/package.json` exists at the repo root. If it does, skip to step 2.
Otherwise restore `mobile/` from the `app-builder-empty-project` template — run from the
repo root:

```bash
curl -fsSL https://github.com/modelence/app-builder-empty-project/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1 app-builder-empty-project-main/mobile
```

It writes only `mobile/`, so it cannot disturb the web app. Verify the command succeeded
before continuing — if the network is unavailable the fetch fails and `mobile/` is still
missing.

Do NOT hand-write these files, and do NOT run `create-expo-app` — it produces the wrong
structure (no Expo Router, no Modelence auth wiring). The template is the single source
of truth: it carries the SDK-pinned dependency set, the Expo Router layout with Modelence
auth wiring, and the `mobile/components/ui/` React Native component library that the rest
of the project assumes exists. Reproducing it by hand silently ships a different
dependency set.

After restoring, verify these exist:

- `mobile/package.json` (with `"main": "expo-router/entry"`)
- `mobile/app.config.js`
- `mobile/app/_layout.tsx` and `mobile/app/index.tsx`
- `mobile/components/ui/`

Then personalize `mobile/app.config.js` for this project: set `name` to the project's
display name, and `slug` + `scheme` to its lowercase-kebab-case form ("My App" →
"my-app"). Leave everything else — `bundleId`, the EAS env reads,
`extra.modelenceBaseUrl` — exactly as the template has it. Those are wired to environment
variables injected at build time; overwriting them breaks publishing.

## Step 2 — verify config

- `mobile/package.json` has `"main": "expo-router/entry"` and the four scripts: `start`,
  `start:web`, `android`, `ios`.
- `mobile/app.config.js` has a `scheme` field (required for deep linking) and
  `extra.modelenceBaseUrl` read from `MODELENCE_SITE_URL`.
- `mobile/.gitignore` ignores `node_modules`, `.expo`, `/dist`, `/web-build`, `*.log`,
  `.env`, and `.env.local`. The `.env` holds `MODELENCE_SITE_URL` and must never be
  committed.

Anchor the build-output entries with a leading slash exactly as written (`/dist`,
`/web-build` — NOT bare `dist`/`web-build`). An unanchored pattern matches at every
level, so a source directory such as `mobile/src/dist/` would be silently skipped by
`git add .`. Leave `node_modules` unanchored so nested copies stay ignored.

### Point the app at a reachable backend (`mobile/.env`)

`app.config.js` reads `MODELENCE_SITE_URL` and falls back to `https://localhost:3000`.
That fallback is never correct on a device: `localhost` resolves to the phone itself, and
the local dev server speaks `http`, not `https`. Left unset, the app's first method call
(`_system.session.init`) fails with a bare `TypeError: Failed to fetch` and a minified
stack inside `modelence/dist/*.js` — the code is fine, the URL is unreachable.

Create `mobile/.env` (gitignored per the list above) with a URL the phone can actually
reach, and tell the user which you chose:

- **Local dev server** — the machine's LAN IP over `http`, with both devices on the same
  Wi-Fi. Find it with `ipconfig getifaddr en0` (macOS) or `hostname -I | awk '{print $1}'`
  (Linux):

  ```
  MODELENCE_SITE_URL=http://192.168.1.42:3000
  ```

- **Deployed Modelence Cloud environment** — works from any network, no LAN needed, and
  is the better choice when the user is on a tunnel, a guest network, or a physical device
  that cannot see the dev machine:

  ```
  MODELENCE_SITE_URL=https://your-app.modelence.app
  ```

Never write `localhost` or `127.0.0.1` into this file, and match the scheme to the host:
`http` for a LAN dev server, `https` only for a real deployed one.

`app.config.js` is evaluated once when Expo starts, so after creating or editing
`mobile/.env` the dev server must be restarted with `npx expo start --clear`. Editing the
file while Expo is running changes nothing.

Port `3000` is the default; if the project's dev server uses another port (`MODELENCE_PORT`
or `PORT` at the repo root), use that one.

## Step 3 — install dependencies

Note the `expo` version in `mobile/package.json` BEFORE installing — you will restore it
if it changes.

Inside `mobile/`, run `npm install`, then `./node_modules/.bin/expo install --fix`. Both
must succeed before continuing.

Invoke the project-local binary by path. Do NOT use `npx expo` / `npm exec expo`: when
the local package isn't fully resolvable — exactly the case right after `npm install`,
since npm extracts package directories long before it links bins — npm silently falls
back to downloading the LATEST CLI from the registry and runs it against this
SDK-pinned project.

`expo install --fix` aligns packages to the SDK-recommended versions and may rewrite the
`expo` entry. After it finishes, re-check `mobile/package.json`: if the `expo` entry
differs from what you noted, restore the original value verbatim and re-run
`npm install` inside `mobile/`. Do NOT "tighten" or "loosen" that value on your own —
whatever the template ships is deliberate, and drifting off it can pick up a CLI that
drops env vars the Modelence mobile preview depends on.

Finally run `./node_modules/.bin/expo install --check` inside `mobile/` and resolve
anything it reports. Every dependency must match the installed SDK, or Expo Go's compiled
native side will not match and the app boots to a blank white screen with no error.

## Step 4 — wire the root postinstall

Do this even when `mobile/` already existed — older projects will not have it, and
without it future `npm install` calls at the root skip mobile dependencies and the app
breaks on fresh clones.

In the ROOT `package.json` (not the one in `mobile/`), ensure the script
`"postinstall": "node scripts/postinstall.mjs"` is present.

If `scripts/postinstall.mjs` does not exist, fetch it from the template alongside its
companion check — both files, from the repo root:

```bash
curl -fsSL https://github.com/modelence/app-builder-empty-project/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1 \
      app-builder-empty-project-main/scripts/postinstall.mjs \
      app-builder-empty-project-main/scripts/check-mobile-deps.mjs
```

`postinstall.mjs` invokes `check-mobile-deps.mjs`, which warns when a package in
`mobile/` does not match what Expo Go bundles. Copying only the first leaves a
postinstall that fails on every install.

Do not hand-write either file. `postinstall.mjs` has to no-op unless the marker exists,
prefer `npm ci` when a lockfile is present, and clear the Metro/Expo caches afterwards
(`npm ci` wipes `node_modules`, which staleness-invalidates Metro and otherwise causes
"App entry not found" in Expo Go on the next start). The template version encodes all of
that.

Do NOT change any other root scripts (`dev`, `build`, `start`).

## Step 5 — build the actual app

The scaffolded screens (sign-in, home) are PLACEHOLDERS. The goal is a mobile version of
THIS project, not an empty starter: reproduce the existing web app (the React UI under
`src/`, backed by the same Modelence queries and mutations) as native React Native
screens.

First gauge the size of the web app — count the meaningful screens, features, and server
queries/mutations it exposes. Then pick one path:

- **Small / medium (up to ~6 screens):** port it fully. Recreate every page as a native
  screen under `mobile/app/`, wire each to the same queries/mutations via
  `@modelence/react-query`, and preserve the navigation structure (auth flow vs. signed-in
  app).
- **Large (many screens, or substantial features):** do NOT port everything in one shot.
  Ask the user whether they want a minimal version covering the core flow (auth + the 1–3
  most important screens) and which screens matter most. Build that set now, wire it to
  the real queries/mutations, and say the rest can follow in later requests. Only port
  the whole app if they explicitly ask for full parity.

Either way, replace the placeholder sign-in and home screens with real ported UI using
the project's actual data and auth — not lorem-ipsum. Keep the styling native (React
Native components, not the web's HTML/CSS) but match the web app's information and
behavior.

Reuse the existing queries and mutations as-is: read `src/` freely, but keep code changes
scoped to `mobile/` plus the root `package.json` postinstall addition. Do not modify
`src/`, `vite.config.ts`, or `modelence.config.ts`.

## Step 6 — write the readiness marker (last)

Write an empty file at `mobile/.modelence-mobile-enabled`. It signals that the mobile app
is ready, and the root `postinstall` script keys off it to start re-installing mobile deps
on future `npm install` runs.

Write it LAST, after steps 2–5 have all succeeded. Writing it early advertises an
incomplete setup as ready.

## Completion checklist

Before reporting done, verify all of these:

- [ ] `mobile/package.json` exists with `"main": "expo-router/entry"` and the four scripts
- [ ] `mobile/app.config.js` exists with `scheme` and `extra.modelenceBaseUrl`
- [ ] `mobile/.env` sets `MODELENCE_SITE_URL` to a host the phone can reach — a LAN IP or a deployed URL, never `localhost`
- [ ] `mobile/index.ts` exists (configureClient + AsyncStorage auth token rehydration)
- [ ] `mobile/app/_layout.tsx` exists (SafeAreaProvider + AppProvider + QueryClientProvider + RouteGuard)
- [ ] `mobile/node_modules/expo` exists (proves install ran)
- [ ] The `expo` entry in `mobile/package.json` is unchanged from what the template shipped, even after `expo install --fix`
- [ ] Placeholder screens replaced with real ported UI wired to the project's queries/mutations
- [ ] Root `package.json` has `"postinstall": "node scripts/postinstall.mjs"`
- [ ] `scripts/postinstall.mjs` exists at the repo root
- [ ] `mobile/.modelence-mobile-enabled` exists
- [ ] `npx tsc --noEmit` passes inside `mobile/`
- [ ] The `expo-router` skill's route checklist passes

If any item is false, complete it before responding.

## Troubleshooting

### "Failed to fetch" / "Network request failed" at app startup

A `TypeError: Failed to fetch` (Expo Web) or `Network request failed` (native) with a
minified stack inside `node_modules/modelence/dist/chunk-*.js`, thrown from a `useEffect`
during the first render, is the boot-time `_system.session.init` call failing to reach the
server. It is a connectivity/config problem, not a code bug — do not start editing
`modelence/dist` or the generated screens. Work through these in order:

1. **Is `MODELENCE_SITE_URL` set?** Without `mobile/.env`, `app.config.js` falls back to
   `https://localhost:3000`, which no phone can reach. See "Point the app at a reachable
   backend" above. This is by far the most common cause.
2. **Is the URL reachable from the phone?** `localhost` and `127.0.0.1` mean the device
   itself. Use the dev machine's LAN IP (both devices on the same Wi-Fi) or a deployed
   URL.
3. **Does the scheme match?** `https://` against a plain-`http` dev server fails the TLS
   handshake. `http` for LAN, `https` for deployed.
4. **Was Expo restarted after the change?** `app.config.js` is read once at start —
   `npx expo start --clear`.
5. **Is the dev server actually running** on that port at the repo root?
6. **On Expo Web only**, a credentialed cross-origin request is blocked by a server
   answering `Access-Control-Allow-Origin: *`. Confirm `mobile/index.ts` passes
   `credentials: 'omit'` to `configureClient` — the template does; a hand-written client
   often omits it.

To confirm the URL independently of the app, curl the method endpoint from the dev
machine — a reachable server returns JSON, not a connection error:

```bash
curl -i -X POST http://192.168.1.42:3000/api/_internal/method/_system.session.init \
  -H 'Content-Type: application/json' -d '{"args":{}}'
```

## App identifier (Android package / iOS bundle id)

The `bundleId` const in `mobile/app.config.js` is the app identifier, used for both
`android.package` and `ios.bundleIdentifier`.

When the user asks to change their package name, bundle id, or app identifier (e.g. "my
Play submission was rejected", "change the package to com.acme.myapp"), edit that single
`bundleId` const — do NOT set android and ios to different values, as builds use one
identifier and a mismatch fails the build.

Rules to enforce:

- Reverse-DNS on a domain the USER controls (`com.theircompany.theirapp`). The default
  `app.modelence.*` is on a domain they do not own, and Google Play rejects submissions
  under it.
- Lowercase only; each dot-separated segment must start with a letter and contain only
  letters, digits, and `_`. Hyphens are invalid.
- WARN before changing it on an app that has already been published: store listings are
  keyed on this identifier permanently, so a new value creates a separate listing and
  abandons existing installs and reviews. Before first publish it is safe to change.

For apps built through Modelence Cloud, editing the file only takes effect before the
first build. Once a build has run, the platform has recorded the identifier and applies
its stored value to every later build — each build also rewrites the `bundleId` const to
that stored value, so a manual edit afterwards is overwritten. Direct the user to change
it in the Publish flow instead; after publishing it cannot be changed at all.

## Production builds

Production builds (`.aab` / `.ipa`) are produced by EAS with the user's own Expo account.
Do NOT run `eas build`, `eas login`, or hand-edit EAS credentials on their behalf — you
do not have their Expo token, and for Modelence Cloud projects the platform runs the build
itself from the Mobile tab's "Production builds" panel.

If asked to set up builds, you MAY ensure `mobile/eas.json` exists and that
`mobile/app.config.js` has an Android `package` and iOS `bundleIdentifier` (both required
by EAS), then hand the build itself back to the user.
