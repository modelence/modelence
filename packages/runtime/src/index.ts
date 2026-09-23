/*
  @modelence/runtime — the container entrypoint for apps on Modelence Cloud.

  Studio's generated Dockerfile installs this package at a version Studio
  pins and runs the `modelence-runtime` bin (./bin.ts) as the container
  command. This module is the importable side, for the CLI and for tests.

  Dependency-free, built for Node.js 18+ so it runs on the bare Node images
  (glibc or Alpine) with nothing else installed.
*/
export { run } from './run';
export { loadRuntimeEnv, mergeRuntimeEnv, type ProcessEnv } from './env';
export { matchMount, stripMountPrefix, type PreparedMount } from './mounts';
export { readWebSpec, WEB_SPEC_ENV_NAME, type StaticMount, type WebSpec } from './spec';
export { resolveStaticFile } from './static';
