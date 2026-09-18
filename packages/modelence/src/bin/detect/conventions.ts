import { commandsFor } from './commands';
import type { ProjectFacts, WorkspaceMember } from './facts';
import { withBuild, withNote, withStart, type Detector, type NamedDetector } from './types';

/*
  Origin-blind conventions, in the order they run. Each fills in what it can
  and leaves the rest untouched, so a later detector (or the user's
  modelence.json) can still decide. Nothing here knows about Replit,
  Lovable or any other tool; that knowledge lives in profiles/.
*/

export const runtimeFromModelenceConfig: Detector = (facts, draft) => {
  if (!facts.hasModelenceConfig) {
    return draft;
  }
  return { ...draft, spec: { ...draft.spec, runtime: 'modelence' } };
};

export const nodeVersionFromEngines: Detector = (facts, draft) => {
  if (!facts.nodeMajor) {
    return draft;
  }
  return withBuild(draft, { node: facts.nodeMajor });
};

export const installFromPackageManager: Detector = (facts, draft) => {
  const commands = commandsFor({
    packageManager: facts.packageManager,
    version: facts.packageManagerVersion,
    useLockfile: facts.lockfile.present && facts.lockfile.inSync,
  });
  let next = withBuild(draft, { install: commands.install });
  for (const note of facts.packageManagerNotes ?? []) {
    next = withNote(next, note);
  }
  if (facts.packageManager !== 'npm' && !facts.lockfile.present) {
    next = withNote(
      next,
      `No ${facts.packageManager} lockfile found; installing without a frozen lockfile.`
    );
  }
  if (facts.packageManager === 'npm' && !facts.lockfile.present) {
    next = withNote(
      next,
      'No package-lock.json found; dependencies are installed with `npm install`.'
    );
  }
  if (facts.packageManager === 'npm' && facts.lockfile.present && !facts.lockfile.inSync) {
    next = withNote(
      next,
      'package-lock.json is out of date with package.json, so dependencies are installed with `npm install`. ' +
        'Run `npm install` locally and commit the lockfile to get reproducible `npm ci` installs.'
    );
  }
  if (facts.packageManager === 'pnpm' && !facts.packageManagerVersion) {
    next = withNote(
      next,
      'Could not tell which pnpm version wrote pnpm-lock.yaml; the build installs the latest. ' +
        'Add e.g. "packageManager": "pnpm@10.4.1" to package.json to pin it.'
    );
  }
  return next;
};

export const buildFromScripts: Detector = (facts, draft) => {
  if (!facts.scripts.build) {
    return draft;
  }
  return withBuild(draft, { command: commandsFor(commandContext(facts)).run('build') });
};

export const startFromProcfileOrScripts: Detector = (facts, draft) => {
  if (facts.procfileWeb) {
    return withStart(draft, facts.procfileWeb, facts.procfileWeb);
  }
  if (facts.scripts.start) {
    return withStart(draft, commandsFor(commandContext(facts)).start, facts.scripts.start);
  }
  return draft;
};

// Deploying one member of a workspace when the root has nothing to start:
// the single member with a start script is the app, and the build is scoped
// to it and its workspace dependencies rather than every sibling.
export const startFromWorkspaceMember: Detector = (facts, draft) => {
  if (draft.spec.web?.start || draft.spec.runtime === 'modelence') {
    return draft;
  }
  const startable = facts.workspace.members.filter((member) => member.scripts.start);
  if (startable.length === 0) {
    return draft;
  }
  if (startable.length > 1) {
    const names = startable.map((member) => member.name).join(', ');
    return withNote(
      draft,
      `Several workspace packages have a start script (${names}); set web.start in modelence.json or pass --start-command to choose one.`
    );
  }
  const [member] = startable;
  const commands = commandsFor(commandContext(facts));
  const inferredBuild = !draft.spec.build?.command;
  const built = inferredBuild
    ? withBuild(draft, { command: commands.buildWithDependencies(member.name) })
    : draft;
  const started = withStart(built, commands.startIn(member.name), member.scripts.start, member);
  return withNote(
    started,
    `No root start script; the container starts the ${member.name} workspace package (${member.dir}/), ` +
      (inferredBuild
        ? 'and the build is scoped to it and its workspace dependencies.'
        : 'and the root build script is preserved.')
  );
};

export const startFallbackNote: Detector = (facts, draft) => {
  if (
    draft.spec.web?.start ||
    draft.spec.web?.static?.length ||
    draft.spec.runtime === 'modelence'
  ) {
    return draft;
  }
  return withNote(
    draft,
    'No `start` script or Procfile found; set web.start in modelence.json or pass --start-command.'
  );
};

export const CONVENTIONS: NamedDetector[] = [
  { name: 'Modelence config', apply: runtimeFromModelenceConfig },
  { name: 'Node engines', apply: nodeVersionFromEngines },
  { name: 'package manager', apply: installFromPackageManager },
  { name: 'root build script', apply: buildFromScripts },
  { name: 'Procfile or start script', apply: startFromProcfileOrScripts },
  { name: 'workspace package', apply: startFromWorkspaceMember },
];

export function commandContext(facts: ProjectFacts) {
  return {
    packageManager: facts.packageManager,
    version: facts.packageManagerVersion,
    useLockfile: facts.lockfile.present && facts.lockfile.inSync,
  };
}

// Workspace members that are Vite apps without a process of their own:
// frontends a profile may mount next to the app.
export function frontendMembers(facts: ProjectFacts): WorkspaceMember[] {
  return facts.workspace.members.filter(
    (member) => member.hasViteConfig && !member.scripts.start && member.scripts.build
  );
}
