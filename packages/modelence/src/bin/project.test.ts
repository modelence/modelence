import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  otherAppHosts,
  projectForHost,
  withHostProject,
  type ProjectFile,
} from './project';

const STAGING = 'https://staging.example';
// What earlier CLIs saved; nothing environment specific is read any more.
const legacyDeploy = { environmentId: 'cloud-env', appAlias: 'app', envAlias: 'prod' };

describe('projectForHost', () => {
  const project: ProjectFile = {
    appId: 'cloud-app',
    hosts: { [STAGING]: { appId: 'staging-app' } },
  };

  it('reads the top level for Modelence Cloud and hosts for every other Studio', () => {
    expect(projectForHost(project, DEFAULT_HOST)).toEqual({ appId: 'cloud-app' });
    expect(projectForHost(project, STAGING)).toEqual({ appId: 'staging-app' });
    expect(projectForHost(project, 'https://unknown.example')).toEqual({});
  });

  it('ignores a deploy target saved by an earlier CLI', () => {
    const legacy = {
      appId: 'cloud-app',
      deploy: legacyDeploy,
      hosts: { [STAGING]: { deploy: legacyDeploy } },
    } as ProjectFile;
    expect(projectForHost(legacy, DEFAULT_HOST)).toEqual({ appId: 'cloud-app' });
    expect(projectForHost(legacy, STAGING)).toEqual({});
  });

  it('ignores malformed entries', () => {
    const broken = { appId: 1, hosts: { [STAGING]: 'x' } } as unknown as ProjectFile;
    expect(projectForHost(broken, DEFAULT_HOST)).toEqual({});
    expect(projectForHost(broken, STAGING)).toEqual({});
  });
});

describe('otherAppHosts', () => {
  it('names the Studios with a saved app other than the given one', () => {
    const project: ProjectFile = {
      appId: 'cloud-app',
      hosts: { [STAGING]: { appId: 'staging-app' }, 'https://empty.example': {} },
    };
    expect(otherAppHosts(project, DEFAULT_HOST)).toEqual([STAGING]);
    expect(otherAppHosts(project, STAGING)).toEqual([DEFAULT_HOST]);
    expect(otherAppHosts(project, 'https://new.example')).toEqual([DEFAULT_HOST, STAGING]);
  });
});

describe('withHostProject', () => {
  it('records another Studio under hosts, leaving the Cloud entry alone', () => {
    const project: ProjectFile = { appId: 'cloud-app', other: 1 };
    expect(withHostProject(project, STAGING, { appId: 'staging-app' })).toEqual({
      appId: 'cloud-app',
      other: 1,
      hosts: { [STAGING]: { appId: 'staging-app' } },
    });
    expect(project).toEqual({ appId: 'cloud-app', other: 1 });
  });

  it('records Modelence Cloud at the top level, leaving other Studios alone', () => {
    const project: ProjectFile = { hosts: { [STAGING]: { appId: 'staging-app' } } };
    expect(withHostProject(project, DEFAULT_HOST, { appId: 'cloud-app' })).toEqual({
      appId: 'cloud-app',
      hosts: { [STAGING]: { appId: 'staging-app' } },
    });
  });

  it("drops the written host's legacy deploy target, and only that host's", () => {
    const project = {
      appId: 'cloud-app',
      deploy: legacyDeploy,
      hosts: { [STAGING]: { appId: 'staging-app', deploy: legacyDeploy } },
    } as ProjectFile;
    expect(withHostProject(project, STAGING, { appId: 'staging-app' })).toEqual({
      appId: 'cloud-app',
      deploy: legacyDeploy,
      hosts: { [STAGING]: { appId: 'staging-app' } },
    });
    expect(withHostProject(project, DEFAULT_HOST, { appId: 'cloud-app' })).toEqual({
      appId: 'cloud-app',
      hosts: { [STAGING]: { appId: 'staging-app', deploy: legacyDeploy } },
    });
  });
});
