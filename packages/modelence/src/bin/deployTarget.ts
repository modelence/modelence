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
