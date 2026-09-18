import type { AppSpec } from '../appSpec';
import type { ProjectFacts } from './facts';

/*
  A detector is a pure step of the pipeline: it looks at the project facts
  and the draft so far, and returns a new draft. Conventions are origin-blind
  rules (lockfile → install command, Procfile → start command…); profiles
  recognize where a project came from and add what that tooling assumes.
  Neither does I/O, so each is tested with a facts object.
*/

export interface Draft {
  spec: AppSpec;
  notes: string[];
}

export type Detector = (facts: ProjectFacts, draft: Draft) => Draft;

export interface NamedDetector {
  name: string;
  apply: Detector;
}

export interface Profile {
  name: string;
  matches: (facts: ProjectFacts) => boolean;
  apply: Detector;
}

export function withBuild(draft: Draft, patch: NonNullable<AppSpec['build']>): Draft {
  return { ...draft, spec: { ...draft.spec, build: { ...draft.spec.build, ...patch } } };
}

export function withWeb(draft: Draft, patch: NonNullable<AppSpec['web']>): Draft {
  return { ...draft, spec: { ...draft.spec, web: { ...draft.spec.web, ...patch } } };
}

export function withNote(draft: Draft, note: string): Draft {
  return { ...draft, notes: [...draft.notes, note] };
}
