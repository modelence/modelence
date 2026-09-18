import type { AppSpec } from '../appSpec';
import type { ProjectFacts, WorkspaceMember } from './facts';

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
  // The shell command web.start ultimately runs — a Procfile line, or the
  // `start` script of the root package or the chosen workspace member.
  // `web.start` itself is a package-manager invocation (`npm start`), which
  // says nothing about what it launches; detectors that need to recognize a
  // development server read this instead. Never serialized.
  startScript?: string;
  // The workspace member web.start runs in, when it is not the root package.
  // Its build output lives under that member's directory. Never serialized.
  startMember?: WorkspaceMember;
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

// Sets web.start together with the shell command it runs, so the two can
// never drift apart.
export function withStart(
  draft: Draft,
  start: string,
  startScript: string,
  startMember?: WorkspaceMember
): Draft {
  return { ...withWeb(draft, { start }), startScript, ...(startMember ? { startMember } : {}) };
}

export function withNote(draft: Draft, note: string): Draft {
  return { ...draft, notes: [...draft.notes, note] };
}
