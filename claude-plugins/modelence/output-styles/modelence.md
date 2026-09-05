---
name: Modelence
description: Modelence framework rules and conventions for building full-stack apps
keep-coding-instructions: true
force-for-plugin: true
---

# Modelence

You are working in a Modelence project — a full-stack TypeScript framework (React + Node.js + MongoDB) with built-in database, authentication, email, cron jobs, and cloud deployment. Follow these rules whenever you write or modify code in this project.

When unsure about a Modelence API or pattern, look it up instead of guessing — do not write unfamiliar Modelence patterns from memory. Use the `modelence-docs` MCP server's `search_modelence` tool when available; otherwise fetch https://docs.modelence.com/llms.txt for the documentation index and read the relevant page.

## Environment

- If `node_modules` is missing, the project's dependencies were never installed — offer to run `npm install` first. You can still read and edit code without it (and the `modelence` MCP server's database tools still work), but type-checking and the dev server will not work until it is installed. Say that plainly instead of silently skipping those verification steps.
- Keep a dev server running while you work and use it to verify changes. First check whether the app already responds on its port (`MODELENCE_PORT`, else `PORT`, else 3000) — if it does, the user is running it themselves; use that one and NEVER start a second server. If nothing responds, start `npm run dev` yourself as a background process rather than asking the user to run it, and tell them the URL once it is up. It is non-interactive (`tsx watch`) and safe to background.
- The dev server is the only thing that serves the user's local edits, and saying so is part of your job: the app they see is the one running on their machine, while the environment's cloud URL serves the code in the connected repository and stays paused while a local session holds the environment. Users arriving from a cloud sandbox may expect edits to appear there by themselves — when a change is meant to be live in the cloud environment, tell them it has to be pushed, and never imply that saving a file publishes anything.
- After changes, read the dev server output and fix what you find: boot failures, missing config, migration and index errors, and unhandled request errors. Type-checking does not catch these. Check the output after a change instead of streaming it continuously, and look for errors rather than reading every line.
- When the user owns the dev server process, its output goes to their terminal and you cannot read it — verify over HTTP and ask them to paste any errors you need.
- `.modelence.env` connects the project to its Modelence Cloud backend, including the MongoDB database. Never edit, delete, or regenerate it.
- If `.modelence.env` is missing, the project is not connected to its backend yet — the file is gitignored, so fresh clones never have it. The dev server and database will not work until it exists. NEVER create or guess this file yourself: tell the user to run `npx modelence@latest setup` in the project — their browser opens to authorize and pick which app and environment to connect (it writes the file with a fresh token). You can still read and edit code in the meantime.
- After making code changes, always run `npx tsc --noEmit` and fix all errors before finishing. Type-checking is not optional — never report work as done with outstanding TypeScript errors.
- Your local checkout is the source of truth for code — read and edit it with your own file tools rather than through a remote MCP server, whose view of the project can be stale and may be rejected while a local session is active.
- The `modelence` MCP server inspects the apps and environments in the user's Modelence organization. Every tool takes an `environmentId`: for this project, read `MODELENCE_ENVIRONMENT_ID` from `.modelence.env` (in the project root) — that is the environment this working copy is connected to, and the same MongoDB your local app reads and writes. Use other environments or apps only when the user asks about them. Use it for diagnosis. App status and server logs come from your own dev server output, not from this server.
- The `modelence` MCP server needs a one-time sign-in. If its tools are missing or it reports it needs authentication, tell the user to run `/mcp` in Claude Code, pick `modelence`, choose Authenticate, and finish in the browser. If the plugin itself is missing, the reinstall steps are at https://docs.modelence.com/ai-coding-agents (`claude plugin marketplace add modelence/modelence`, then `claude plugin install modelence@modelence`). Never ask the user for a token.

## Database

- Modelence has a built-in MongoDB database, used via the Store SDK (`Store` and `schema` from `modelence/server`). NEVER set up another database and NEVER use raw MongoDB drivers or mongoose. If the user wants to connect a different MongoDB database, direct them to their Modelence dashboard.
- When building new functionality, start from defining a Store whenever it makes sense for data to be persisted.
- Migrations run inside the same app process as the rest of the code — they are NOT standalone scripts. They share the module context, including Stores. NEVER define a new Store inside a migration file: define Stores in a separate db.ts and import them. Migration files contain only the migration handler logic operating on existing Stores.
- If Modelence MCP database tools are available (mongo find/count/aggregate), use them for diagnosis only — confirming query results, verifying migrations, inspecting stored document shapes. Data the app itself reads or writes always belongs in Stores, queries, and mutations, never in direct database access.

## Configuration

- NEVER use `process.env` for app configuration. Always use `configSchema` (per module) and `getConfig`. Config values are per-environment, editable in the Modelence dashboard, and survive deployment — ad-hoc env vars do not.
- Always use the `secret` config type for API keys, tokens, passwords, and other sensitive values — secrets are encrypted at rest and masked in the dashboard.
- `getConfig` is synchronous and returns `string | number | boolean | undefined` — do not `await` it, and cast the result to the expected type.
- If a third-party library has no programmatic config and strictly reads from `process.env`, assign the value before use as a last resort: `process.env.SOME_KEY = getConfig('someKey') as string`.
- NEVER hardcode the app's own URL in app code — not `localhost:3000`, not a sandbox or deployment URL. When the app needs its own URL (links, emails, redirects, OAuth callbacks), use `getConfig('_system.site.url')` from `modelence/server`. Hardcoded URLs break on deployment and custom domains.

## Framework patterns

- Client-server communication uses typed queries and mutations (`modelenceQuery` / `modelenceMutation` from `@modelence/react-query`, consumed with `@tanstack/react-query`). NEVER write `fetch('/api/...')` calls or custom Express/Next.js-style API routes for client-server communication. Reserve server routes for genuinely custom endpoints (webhooks, external callbacks).
- The app starts with a single `startApp` call (typically `app.ts` or `index.ts`) receiving all Modules. Each Module owns its stores, queries, mutations, configSchema, server routes, and cron jobs.
- When the user pastes existing code from elsewhere, do NOT accept it as-is. Rewrite incompatible patterns (direct fetch calls, custom API routes, non-Modelence auth, raw database access) into Modelence-native equivalents, and tell the user what you changed. When unsure whether a pattern is valid in Modelence, search the docs first.
- For complete working examples (Module, Store, queries/mutations, cron jobs, config, React pages), consult the `modelence-patterns` skill.

## Authentication

- Use Modelence's built-in authentication. Default to password auth; avoid social logins unless the user explicitly requests them (providers need dashboard-side setup in the Authentication Providers page and won't work out of the box).
- For authorization, declare roles in the `roles` option of `startApp`, then check them on the `user` object inside handlers: `user.requireRole('admin')` (throws) or `user.hasRole('admin')` (boolean). `requireRole` is a method on `user`, never a standalone import. Users are assigned roles in the dashboard Users page.
- Always check `user` in queries/mutations that touch user-owned data, and verify ownership before returning or modifying documents.

## Modelence dashboard

Some platform features require dashboard-side setup that cannot be done from code: config values, auth providers, email providers, user roles, database connections, and file storage. When one of these is involved, make the code-side change yourself, then direct the user to the relevant page of their Modelence dashboard for the rest — search the Modelence docs if unsure which page handles what.

## Email

Transactional email works out of the box via Modelence's built-in managed provider — no setup required. Connecting a third-party provider (e.g. Resend) is optional, for a custom sending domain or better deliverability, and requires both code-side configuration and dashboard-side setup in the Email tab.

## UI design

- Follow the app's design style guide in `src/client/index.css`, where Tailwind is configured CSS-first via the `@theme` directive. Read this file before making UI changes to understand the design identity (palette, fonts, spacing).
- Reuse existing project UI components. For new components, use shadcn whenever applicable. Use Lucide icons (`lucide-react`) consistently.
- Add smooth animations and transitions: page transitions, element entrances, hover effects, and loading states, using the `--animate-*` utilities defined in `index.css` and Tailwind transition classes.
- Avoid generic AI-generated aesthetics: cookie-cutter layouts, competing colors, inconsistent spacing, overused fonts (Inter, Roboto, Arial), and purple/blue gradients on white backgrounds.

## Mobile

If the project contains a mobile app (Expo Router under `mobile/`), read the `expo-router` skill before creating, moving, or linking any screen — its URL rules prevent "Unmatched Route" errors that type-checking cannot catch.
