import type { AppSpec } from '../appSpec';
import { CONVENTIONS, runDetectors } from './conventions';
import { gatherProjectFacts, type ProjectFacts } from './facts';
import { lovableProfile } from './profiles/lovable';
import { replitProfile } from './profiles/replit';
import type { Draft, Profile } from './types';

/*
  Infers an app spec from the project, the way Heroku's Node buildpack
  infers its build: conventions first (lockfile, scripts, Procfile,
  engines, workspaces), then the profile of the tool the project came from,
  when one is recognized. The result is one layer of the spec the server
  merges under modelence.json and the environment's settings — so anything
  it gets wrong is overridable, and `modelence init` writes it to the file
  where it can be edited.

  Adding support for a new origin means adding a profile file and a
  fixture; nothing here or in the conventions changes.
*/

export const PROFILES: Profile[] = [replitProfile, lovableProfile];

export interface DetectedAppSpec {
  spec: AppSpec;
  notes: string[];
  // The recognized origin, if any.
  profile: string | null;
}

export function detectFromFacts(facts: ProjectFacts): DetectedAppSpec {
  const start: Draft = { spec: {}, notes: [] };
  const conventional = runDetectors(facts, CONVENTIONS, start);
  const profile = PROFILES.find((candidate) => candidate.matches(facts)) ?? null;
  const final = profile ? profile.apply(facts, conventional) : conventional;
  return { ...final, profile: profile?.name ?? null };
}

export async function detectAppSpec(cwd = process.cwd()): Promise<DetectedAppSpec> {
  return detectFromFacts(await gatherProjectFacts(cwd));
}
