import type { PackageManager } from './parsers';

/*
  The shell commands each package manager needs for the same intents, so
  detectors say "install", "run build in member X" and never spell out a
  manager-specific line themselves.
*/

export interface PackageManagerCommands {
  install: string;
  run: (script: string) => string;
  start: string;
  // Run a script in one workspace member.
  runIn: (member: string, script: string) => string;
  // Build one member plus its workspace dependencies (pnpm's `name...`
  // filter); npm and yarn classic have no closure syntax, so only the
  // member itself is built there.
  buildWithDependencies: (member: string) => string;
  startIn: (member: string) => string;
}

export function commandsFor({
  packageManager,
  version,
  useLockfile,
}: {
  packageManager: PackageManager;
  version?: string;
  useLockfile: boolean;
}): PackageManagerCommands {
  switch (packageManager) {
    case 'pnpm': {
      // Without a pin `npm install -g pnpm` picks whatever is latest, which
      // can be a major ahead of the lockfile and refuse the install.
      const pnpmPackage = version ? `pnpm@${version}` : 'pnpm';
      return {
        install: `npm install -g ${pnpmPackage} && pnpm install ${useLockfile ? '--frozen-lockfile' : '--no-frozen-lockfile'}`,
        run: (script) => `pnpm run ${script}`,
        start: 'pnpm start',
        runIn: (member, script) => `pnpm --filter ${member} run ${script}`,
        buildWithDependencies: (member) => `pnpm --filter ${member}... --if-present run build`,
        startIn: (member) => `pnpm --filter ${member} start`,
      };
    }
    case 'yarn': {
      const modern = version !== undefined && Number(version.split('.')[0]) >= 2;
      const setup = version
        ? `corepack enable && corepack prepare yarn@${version} --activate && `
        : '';
      return {
        install:
          setup +
          (modern
            ? useLockfile
              ? 'yarn install --immutable'
              : 'YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install'
            : `yarn install${useLockfile ? ' --frozen-lockfile' : ''}`),
        run: (script) => `yarn ${script}`,
        start: 'yarn start',
        runIn: (member, script) => `yarn workspace ${member} run ${script}`,
        buildWithDependencies: (member) => `yarn workspace ${member} run build`,
        startIn: (member) => `yarn workspace ${member} start`,
      };
    }
    default:
      return {
        install: useLockfile ? 'npm ci' : 'npm install',
        run: (script) => `npm run ${script}`,
        start: 'npm start',
        runIn: (member, script) => `npm run ${script} --workspace ${member}`,
        buildWithDependencies: (member) => `npm run build --if-present --workspace ${member}`,
        startIn: (member) => `npm start --workspace ${member}`,
      };
  }
}
