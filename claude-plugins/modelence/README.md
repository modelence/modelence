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
- **`modelence` MCP server** — queries the databases and environments of the apps in your
  Modelence organization, for diagnosis while you build. Inside a project, Claude uses the
  environment the project is connected to.

## Installation

Projects created from the Modelence app template, or connected with `npx modelence setup`,
declare the plugin in `.claude/settings.json`; Claude Code shows the install command the
first time you open such a project. To install it anywhere else:

```bash
claude plugin marketplace add modelence/modelence
claude plugin install modelence@modelence
```

The `modelence` MCP server then needs a one-time sign-in with your Modelence account
(`/mcp` → `modelence` → **Authenticate**). Step-by-step instructions for the terminal,
VS Code, JetBrains and the Claude desktop app — installing, reloading, and signing in —
are in the docs: [docs.modelence.com/ai-coding-agents](https://docs.modelence.com/ai-coding-agents#claude-code-plugin).

## Usage

The skills and output style activate on their own inside a Modelence project — there is
nothing to invoke. To browse them explicitly:

- `/modelence:modelence-patterns` — reference implementations for framework patterns
- `/modelence:expo-router` — mobile routing rules

## Requirements

- [Claude Code](https://code.claude.com) v2.1.195 or later
- A Modelence project — start one at [modelence.com](https://modelence.com) or with
  `npx create-modelence-app`

## License

MIT
