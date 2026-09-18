import type { AppSpec } from '../appSpec';
import { CONVENTIONS, startFallbackNote } from './conventions';
import { FRAMEWORKS } from './frameworks';
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
  // Per-field provenance for diagnostics; never sent as executable app config.
  sources: Record<string, string>;
}

export function detectFromFacts(facts: ProjectFacts): DetectedAppSpec {
  let draft: Draft = { spec: {}, notes: [] };
  const sources: Record<string, string> = {};
  const profile = PROFILES.find((candidate) => candidate.matches(facts)) ?? null;
  const steps = [...CONVENTIONS, ...FRAMEWORKS, ...(profile ? [profile] : [])];
  for (const step of steps) {
    const before = fields(draft.spec);
    draft = step.apply(facts, draft);
    const after = fields(draft.spec);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) delete sources[key];
      else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) sources[key] = step.name;
    }
  }
  draft = startFallbackNote(facts, draft);
  return { ...draft, profile: profile?.name ?? null, sources };
}

function fields(spec: AppSpec): Record<string, unknown> {
  return {
    ...(spec.runtime ? { runtime: spec.runtime } : {}),
    ...Object.fromEntries(
      Object.entries(spec.build ?? {}).map(([key, value]) => [`build.${key}`, value])
    ),
    ...Object.fromEntries(
      Object.entries(spec.web ?? {}).map(([key, value]) => [`web.${key}`, value])
    ),
  };
}

export async function detectAppSpec(cwd = process.cwd()): Promise<DetectedAppSpec> {
  return detectFromFacts(await gatherProjectFacts(cwd));
}
