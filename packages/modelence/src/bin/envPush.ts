import { APP_SPEC_FILE_NAME, type EnvDeclaration } from './appSpec';

export interface EnvVarFlags {
  secret?: boolean;
  scopes?: ('build' | 'runtime')[];
}

// One variable as /api/cli/env takes it. Studio works out the flags not given.
export interface EnvVarChange {
  key: string;
  value: string;
  requested?: EnvVarFlags;
  declaration?: { type?: 'text' | 'secret'; scopes?: ('build' | 'runtime')[] };
  // Typed on the command line; Studio refuses it for a secret.
  plainOnly?: boolean;
}

export interface EnvPushPlan {
  changes: EnvVarChange[];
  skipped: { key: string; reason: string }[];
}

// By own name only: a variable can be called "constructor".
export function findDeclaration(
  declarations: Record<string, EnvDeclaration> | null,
  key: string
): EnvDeclaration | undefined {
  return new Map(Object.entries(declarations ?? {})).get(key);
}

/*
  What `env push` sends of a local file: the variables modelence.config.json
  declares, as it declares them. With `all` also the rest, which Studio stores
  as secrets for the running app unless it already knows them. Empty values
  stay behind: in a local file they mean "not filled in", and would blank the
  value the environment has.
*/
export function planEnvPush(
  values: Record<string, string>,
  declarations: Record<string, EnvDeclaration>,
  all: boolean
): EnvPushPlan {
  const entries = Object.entries(values).map(([key, value]) => {
    const declaration = findDeclaration(declarations, key);
    return { key, value, declaration, reason: skipReason(key, value, declaration, all) };
  });
  return {
    changes: entries.flatMap(({ key, value, declaration, reason }) => {
      if (reason !== null) {
        return [];
      }
      return declaration && declaration.type !== 'resource'
        ? [{ key, value, declaration: { type: declaration.type, scopes: declaration.scopes } }]
        : [{ key, value }];
    }),
    skipped: entries.flatMap(({ key, reason }) => (reason === null ? [] : [{ key, reason }])),
  };
}

function skipReason(
  key: string,
  value: string,
  declaration: EnvDeclaration | undefined,
  all: boolean
): string | null {
  if (key === 'PORT' || key.startsWith('MODELENCE_')) {
    return 'set by the platform';
  }
  if (declaration?.type === 'resource') {
    return `comes from the resource "${declaration.resource}"`;
  }
  if (!declaration && !all) {
    return `not declared in ${APP_SPEC_FILE_NAME} (--all includes it)`;
  }
  return value === '' ? 'empty' : null;
}
