# @modelence/runtime

The container entrypoint for apps deployed to Modelence Cloud. Modelence Cloud's
build installs a pinned version of this package into every app image and runs
`modelence-runtime` as the container command.

On start it reads `MODELENCE_WEB` (the start command and static mounts from
`modelence.config.json`) and:

- fetches the environment variables set in the Modelence dashboard with the
  container's service token and runs the start command with them;
- serves static mounts with single-page app fallback, when there is no start
  command;
- with both, serves the mounts and proxies everything else to the app.

Zero runtime dependencies; Node.js 18 or newer.

## Development

TypeScript in `src/`, built with tsup to `dist/` (`npm run build`).
`src/bin.ts` is the `modelence-runtime` executable and `src/index.ts` the
importable API. `npm test` builds first, because the bin tests run the built
`dist/bin.js` as a child process — the same file that ships.

## Releasing

Versions are immutable and pinned by Studio, so a change here reaches tenant
containers only when Studio bumps its pin. Bump `version`, then push a
`@modelence/runtime@<version>` tag to publish (`prepack` builds `dist/`).
