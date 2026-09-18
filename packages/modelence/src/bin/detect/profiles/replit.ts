import { basename } from 'path';
import { commandContext, frontendMembers } from '../conventions';
import { commandsFor } from '../commands';
import { allDependencies, type ProjectFacts, type WorkspaceMember } from '../facts';
import { withBuild, withNote, withWeb, type Draft, type Profile } from '../types';

/*
  Projects exported from Replit. Two things Replit's tooling assumes that
  nothing in the repo says:

  - Replit's "artifacts" workspaces run each artifact as its own process
    behind Replit's application router: the API owns /api and each Vite
    frontend owns a BASE_PATH. In one container that becomes static mounts
    in front of the API, with each frontend built for its mount path.
  - Its Vite configs refuse to load without PORT and BASE_PATH, so those
    are handed to each frontend's build.

  Replit also provisions services (Postgres, Clerk keys) through its own
  environment; those are named here so the first deploy doesn't have to
  crash to reveal them.
*/

// Replit's design-time artifact, not part of the product.
const DESIGN_TOOL_MEMBERS = ['@workspace/mockup-sandbox'];
// Replit's artifact template builds Vite frontends here.
const DEFAULT_ARTIFACT_OUT_DIR = 'dist/public';

function mountPathFor(member: WorkspaceMember, single: boolean): string {
  return single ? '/' : `/${basename(member.dir)}`;
}

function mountFrontends(facts: ProjectFacts, draft: Draft): Draft {
  if (!draft.spec.web?.start || draft.spec.web.static?.length) {
    return draft;
  }
  const frontends = frontendMembers(facts).filter(
    (member) => !DESIGN_TOOL_MEMBERS.includes(member.name)
  );
  if (frontends.length === 0) {
    return draft;
  }
  const commands = commandsFor(commandContext(facts));
  const mounts = frontends.map((member) => ({
    path: mountPathFor(member, frontends.length === 1),
    dir: `${member.dir}/${member.viteOutDir ?? DEFAULT_ARTIFACT_OUT_DIR}`,
  }));
  const frontendBuilds = frontends.map(
    (member, index) => `BASE_PATH=${mounts[index].path} ${commands.runIn(member.name, 'build')}`
  );
  const command = [draft.spec.build?.command, ...frontendBuilds].filter(Boolean).join(' && ');

  let next = withWeb(withBuild(draft, { command }), { static: mounts });
  next = withNote(
    next,
    `Replit artifacts: ${frontends.map((member) => member.name).join(', ')} ` +
      (frontends.length === 1
        ? 'is served at / in front of the API.'
        : 'are served at their folder names in front of the API; edit web.static in modelence.json to change the paths.')
  );
  return next;
}

function noteProvisionedServices(facts: ProjectFacts, draft: Draft): Draft {
  let next = draft;
  if (facts.replit?.modules.some((module) => module.startsWith('postgresql'))) {
    next = withNote(
      next,
      'Replit provisioned a Postgres database; set DATABASE_URL in the environment variables to one this app can reach.'
    );
  }
  if (Object.keys(allDependencies(facts)).some((name) => name.startsWith('@clerk/'))) {
    next = withNote(
      next,
      'Replit managed Clerk auth; set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in the environment variables.'
    );
  }
  return next;
}

export const replitProfile: Profile = {
  name: 'replit',
  matches: (facts) => facts.replit !== undefined,
  apply: (facts, draft) => noteProvisionedServices(facts, mountFrontends(facts, draft)),
};
