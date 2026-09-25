import type { DeployOptions } from './deploy';
import type { ProjectFile } from './project';

export type CliTarget =
  | { environmentId: string }
  | { appAlias: string; envAlias: string }
  | { appId: string; envAlias: string };

export function resolveTargetFromOptions(
  options: DeployOptions,
  project: ProjectFile
): CliTarget | null {
  if (options.app && options.env) {
    return { appAlias: options.app, envAlias: options.env };
  }
  if (options.env && project.deploy?.appAlias) {
    return { appAlias: project.deploy.appAlias, envAlias: options.env };
  }
  if (options.env && project.appId) {
    return { appId: project.appId, envAlias: options.env };
  }
  if (options.app || options.env) {
    throw new Error('Pass both --app and --env, or neither to pick the target in the browser.');
  }
  if (project.deploy?.environmentId) {
    return { environmentId: project.deploy.environmentId };
  }
  return null;
}

// How the target reads in the CLI output, with where it came from.
export function describeTarget(target: CliTarget, project: ProjectFile): string {
  if ('environmentId' in target) {
    const saved = project.deploy;
    const name =
      saved?.environmentId === target.environmentId
        ? `${saved.appAlias}/${saved.envAlias}`
        : target.environmentId;
    return `${name} (saved in .modelence/project.json)`;
  }
  if ('appAlias' in target) {
    return `${target.appAlias}/${target.envAlias}`;
  }
  return target.envAlias;
}

/*
  Flags naming another environment than the one this project normally
  deploys to. A plain `modelence deploy` goes to the saved target, so a
  flag that points elsewhere (production, say) is worth a second look.
*/
export function differsFromSavedTarget(target: CliTarget, project: ProjectFile): boolean {
  const saved = project.deploy;
  if (!saved || 'environmentId' in target) {
    return false;
  }
  if ('appAlias' in target && target.appAlias !== saved.appAlias) {
    return true;
  }
  return target.envAlias !== saved.envAlias;
}
