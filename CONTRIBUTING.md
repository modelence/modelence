# Contributing to Modelence

Thanks for your interest in Modelence. This document explains what to send as a pull request, and what to raise as an issue first.

## Bug fixes and small improvements

**Just open a PR.** You don't need to ask permission first. This covers:

- bug fixes with a clear reproduction
- documentation and typo fixes (batch several typos into one PR rather than sending each separately)
- tests for existing behavior
- error-message and logging improvements
- small internal refactors that don't change behavior

## Changes to the core runtime or public API surface

**Please open an issue first**, describe the problem and the change you have in mind, and wait for a maintainer to agree on the approach before writing the code. A maintainer will normally reply within a few days.

This applies to anything that:

- adds, removes, or changes the signature of an export from `modelence`, `modelence/client`, `modelence/server`, `modelence/telemetry`, `modelence/mongodb`, or `modelence/types`
- changes the `modelence` CLI's commands, flags, or output
- changes runtime behavior in auth, methods, data/db, cron, live-query, rate limiting, or websockets in a way existing apps would notice
- introduces a new package, a new dependency, or a new configuration option
- reorganizes files across modules, or reformats code the change doesn't otherwise touch
- or, more generally, **anything you aren't confident a maintainer would agree with automatically**

**Large unsolicited PRs may be closed without review.** If that happens, it's not a judgment on the quality of your work. Modelence is young and the core team is small, and every API we ship is one we maintain and support indefinitely — so we need to agree on the shape of a change before you spend a weekend building it, not after. A half-hour issue conversation prevents a week-long PR rewrite, and it keeps us from leaving your PR open for months while we decide.

We'd also rather hear about a problem we haven't considered than not hear about it, so if you're unsure which side of the line your change falls on, open an issue and ask. That's always the cheaper mistake.

## Before you open a PR

1. **Search existing issues and PRs** so you're not duplicating work in flight.
2. **Keep it focused.** One concern per PR. Unrelated cleanups make a change harder to review and harder to revert.
3. **Include a reproduction for bug fixes** — ideally as a failing test that your change makes pass.
4. **Don't commit `package-lock.json`** unless the change is specifically about dependencies. Local installs regenerate it, and the churn obscures the real diff.
5. **Don't bump package versions.** Releases are cut by maintainers; see [PUBLISHING.md](PUBLISHING.md).

## Development setup

Requires Node.js 22 or later. The core package is `packages/modelence`:

```bash
git clone https://github.com/modelence/modelence.git
cd modelence/packages/modelence
npm install
npm run build
```

The [Local Development](README.md#local-development-modelence-framework) section of the README covers watch mode and how to point a test app at your local build.

## Checks

CI runs these against `packages/modelence` on every pull request. Run them locally first:

```bash
npm run lint:check     # eslint
npm run format:check   # prettier
npm run test           # vitest
npm run build          # tsup
```

`npm run lint` and `npm run format` fix in place. A pre-commit hook runs Prettier on staged files, so formatting is usually handled for you.

Add tests for behavior you change. Tests live next to the code they cover, as `*.test.ts`.

## Commit messages

Follow the existing convention in the log:

```
fix(auth): clear persisted browser session on logout
feat: allow to configure trusted proxies
docs: remove non-existent method options
```

Types in use: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. A scope in parentheses is optional.

## Reporting bugs

A good issue includes what you expected, what happened instead, steps to reproduce, your Modelence version, and any error output. A link to a minimal reproduction repo is the single most useful thing you can provide.

## Security

**Please don't report security vulnerabilities in a public issue.** Email [support@modelence.com](mailto:support@modelence.com) instead, and give us a chance to ship a fix before the details are public.

## Where to reach us

- **Bugs and feature requests:** [GitHub Issues](https://github.com/modelence/modelence/issues)
- **Questions and discussion:** [Discord](https://discord.gg/ghxu5PDnkZ)
- **Examples:** [modelence/examples](https://github.com/modelence/examples)
