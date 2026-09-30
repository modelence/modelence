import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  otherTargetHosts,
  projectForHost,
  withHostProject,
  type ProjectFile,
} from './project';

const STAGING = 'https://staging.example';
const cloudTarget = { environmentId: 'cloud-env', appAlias: 'app', envAlias: 'prod' };
const stagingTarget = { environmentId: 'staging-env', appAlias: 'app', envAlias: 'dev' };

describe('projectForHost', () => {
  const project: ProjectFile = {
    appId: 'cloud-app',
    deploy: cloudTarget,
    hosts: { [STAGING]: { appId: 'staging-app', deploy: stagingTarget } },
  };

  it('reads the top level for Modelence Cloud and hosts for every other Studio', () => {
    expect(projectForHost(project, DEFAULT_HOST)).toEqual({
      appId: 'cloud-app',
      deploy: cloudTarget,
    });
    expect(projectForHost(project, STAGING)).toEqual({
      appId: 'staging-app',
      deploy: stagingTarget,
    });
    expect(projectForHost(project, 'https://unknown.example')).toEqual({});
  });

  // Pre-release CLIs kept the last Studio's target at the top level.
  it('reads a top-level target with a host as belonging to that Studio', () => {
    const legacy: ProjectFile = {
      appId: 'staging-app',
      deploy: { ...stagingTarget, host: STAGING },
    };
    expect(projectForHost(legacy, DEFAULT_HOST)).toEqual({});
    expect(projectForHost(legacy, STAGING)).toMatchObject({
      appId: 'staging-app',
      deploy: stagingTarget,
    });
  });

  it('ignores malformed entries', () => {
    const broken = { deploy: 'x', hosts: { [STAGING]: { deploy: {} } } } as unknown as ProjectFile;
    expect(projectForHost(broken, DEFAULT_HOST)).toEqual({});
    expect(projectForHost(broken, STAGING)).toEqual({});
  });
});

describe('otherTargetHosts', () => {
  it('names the Studios with a saved target other than the given one', () => {
    const project: ProjectFile = {
      deploy: cloudTarget,
      hosts: { [STAGING]: { deploy: stagingTarget }, 'https://app-only.example': { appId: 'a' } },
    };
    expect(otherTargetHosts(project, DEFAULT_HOST)).toEqual([STAGING]);
    expect(otherTargetHosts(project, STAGING)).toEqual([DEFAULT_HOST]);
    expect(otherTargetHosts(project, 'https://new.example')).toEqual([DEFAULT_HOST, STAGING]);
  });
});

describe('withHostProject', () => {
  it('records another Studio under hosts, leaving the Cloud target alone', () => {
    const project: ProjectFile = { appId: 'cloud-app', deploy: cloudTarget, other: 1 };
    expect(
      withHostProject(project, STAGING, { appId: 'staging-app', deploy: stagingTarget })
    ).toEqual({
      appId: 'cloud-app',
      deploy: cloudTarget,
      other: 1,
      hosts: { [STAGING]: { appId: 'staging-app', deploy: stagingTarget } },
    });
    expect(project).toEqual({ appId: 'cloud-app', deploy: cloudTarget, other: 1 });
  });

  it('records Modelence Cloud at the top level, leaving other Studios alone', () => {
    const project: ProjectFile = { hosts: { [STAGING]: { deploy: stagingTarget } } };
    expect(
      withHostProject(project, DEFAULT_HOST, { appId: 'cloud-app', deploy: cloudTarget })
    ).toEqual({
      appId: 'cloud-app',
      deploy: cloudTarget,
      hosts: { [STAGING]: { deploy: stagingTarget } },
    });
  });

  it('merges into an existing host entry', () => {
    const project: ProjectFile = { hosts: { [STAGING]: { deploy: stagingTarget } } };
    expect(withHostProject(project, STAGING, { appId: 'staging-app' })).toEqual({
      hosts: { [STAGING]: { appId: 'staging-app', deploy: stagingTarget } },
    });
  });

  it('moves a pre-release top-level target for another Studio under hosts', () => {
    const legacy: ProjectFile = {
      appId: 'staging-app',
      deploy: { ...stagingTarget, host: STAGING },
    };
    expect(
      withHostProject(legacy, DEFAULT_HOST, { appId: 'cloud-app', deploy: cloudTarget })
    ).toEqual({
      appId: 'cloud-app',
      deploy: cloudTarget,
      hosts: { [STAGING]: { appId: 'staging-app', deploy: stagingTarget } },
    });
  });
});
