# Modelence plugin for Claude Code

Teaches Claude Code how to build [Modelence](https://modelence.com) apps — a full-stack
TypeScript framework (React + Node.js + MongoDB) with built-in database, authentication,
email, cron jobs, and cloud deployment.

## What's included

- **`modelence-patterns` skill** — complete working examples of the core building
  blocks: `Module`, `Store`, queries, mutations, `configSchema`, cron jobs, and React
  pages using `modelenceQuery`/`modelenceMutation`. Claude loads it automatically when
  creating or modifying any of these.
- **`expo-router` skill** — Expo Router rules for Modelence mobile apps: URL and group
  segment semantics, the canonical tabs layout, and a pre-completion checklist that
  prevents "Unmatched Route" errors type-checking can't catch.
- **Modelence output style** — project-wide conventions: how to run and verify against
  the dev server, database rules (Store SDK only, never raw drivers), type-checking
  before finishing, and how `.modelence.env` connects a project to its cloud backend.
- **`modelence-docs` MCP server** — searches the official docs at
  [docs.modelence.com](https://docs.modelence.com), so Claude looks up unfamiliar APIs
  instead of guessing.
- **`modelence` MCP server** — queries the database and environment of the Modelence
  Cloud environment the project is connected to, for diagnosis while you build.

## Installation

```bash
claude plugin marketplace add modelence/modelence
claude plugin install modelence@modelence
```

Projects created from the Modelence app template, or connected with
`npx modelence setup`, enable the plugin automatically via `.claude/settings.json`.

## Usage

The skills and output style activate on their own inside a Modelence project — there is
nothing to invoke. To browse them explicitly:

- `/modelence:modelence-patterns` — reference implementations for framework patterns
- `/modelence:expo-router` — mobile routing rules

## Authentication

The docs server is public and needs no credentials.

The `modelence` cloud server authenticates in one of two ways:

- **Automatic, environment-scoped**: if the project has a `.modelence.env` (written by
  `npx modelence setup`), the plugin's `scripts/mcp-auth.js` helper reads
  `MODELENCE_SERVICE_TOKEN` from it and sends it as a header. The token is only ever
  sent to the default production URL or to localhost — if `MODELENCE_MCP_URL` points
  the server anywhere else (a development override), the helper sends no credentials
  at all.
- **OAuth sign-in**: without a token the server responds with an OAuth challenge and
  Claude Code offers the normal `/mcp` sign-in flow.

The helper never edits `.modelence.env` and sends nothing anywhere except the MCP
endpoint it authenticates.

## Requirements

- [Claude Code](https://code.claude.com) with plugin support
- Node.js (for the MCP auth helper)
- A Modelence project — start one at [modelence.com](https://modelence.com) or with
  `npx create-modelence-app`

## License

MIT
