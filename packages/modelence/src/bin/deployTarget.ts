import type { DeployOptions } from './deploy';
import type { HostProject } from './project';

export type CliTarget =
  | { environmentId: string }
  | { appAlias: string; envAlias: string }
  | { appId: string; envAlias: string };

export function resolveTargetFromOptions(
  options: DeployOptions,
  project: HostProject,
  // Studios the project has a saved target for, when it has none for this one.
  otherHosts: string[] = []
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
  if (options.env && !options.app && otherHosts.length > 0) {
    throw new Error(
      `--env needs --app here: ${describeOtherHosts(otherHosts)} Pass --app too, or --host to deploy there.`
    );
  }
  if (options.app || options.env) {
    throw new Error('Pass both --app and --env, or neither to pick the target in the browser.');
  }
  if (project.deploy?.environmentId) {
    return { environmentId: project.deploy.environmentId };
  }
  return null;
}

export function describeOtherHosts(otherHosts: string[]): string {
  return `the target saved in .modelence/project.json is for ${otherHosts.join(', ')}, not this Studio.`;
}
