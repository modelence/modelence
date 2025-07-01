# Modelence Monorepo

This monorepo uses modern tooling for efficient development and publishing:

## Tools Used

- **pnpm Workspaces** - For package management and dependency handling
- **Turborepo** - For task running, caching, and parallel execution
- **Changesets** - For versioning and publishing packages

## Getting Started

### Prerequisites

- Node.js 18 or higher
- pnpm 8 or higher

### Installation

```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Install dependencies for all packages
pnpm install
```

### Development

```bash
# Build all packages
pnpm build

# Start development mode for all packages
pnpm dev

# Run type checking across all packages
pnpm type-check

# Clean all build artifacts
pnpm clean
```

### Working with Changesets

When you make changes that should be published:

```bash
# Add a changeset (describes what changed)
pnpm changeset

# Version packages based on changesets
pnpm version-packages

# Build and publish packages
pnpm release
```

### Package Structure

- `packages/modelence` - Core Modelence framework
- `packages/ai` - AI engine for Modelence
- `packages/auth-ui` - Authentication UI components
- `packages/next` - Next.js integration
- `packages/react-query` - React Query utilities
- `packages/types` - Shared TypeScript types
- `packages/create-modelence-app` - CLI tool for creating apps
- `docs/gen` - Documentation generation

### Turborepo Benefits

- **Caching**: Build outputs are cached and shared across the team
- **Parallel execution**: Tasks run in parallel when possible
- **Dependency-aware**: Builds dependencies first automatically
- **Remote caching**: Can be configured for team/CI caching

### pnpm Workspace Benefits

- **Efficient storage**: Shared dependencies across packages
- **Fast installs**: Only downloads each package once
- **Workspace linking**: Packages can depend on each other
- **Hoisting prevention**: Better dependency isolation
