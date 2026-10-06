import type { EnvDeclaration } from './appSpec';
import { APP_SPEC_FILE_NAME } from './appSpec';
import type { CliTarget } from './deployTarget';
import type { Session } from './deploySession';
import { StudioApiError, studioRequest } from './studioApi';
import { ask } from './terminal';

/*
  Before a deploy uploads anything: the variables modelence.config.json
  declares that the target has no value for are asked for at the terminal
  and set on the environment, so adding a variable to the file doesn't ship
  an app that can't start. Each one can be skipped; the deploy then names it
  again, as it always has. Only for someone at the terminal; CI deploys keep
  just the warning.
*/
export async function fillMissingEnvVars({
  session,
  target,
  env,
}: {
  session: Session;
  target: CliTarget;
  env: Record<string, EnvDeclaration> | undefined;
}): Promise<void> {
  if (!env || Object.keys(env).length === 0) {
    return;
  }
  const request = (values: { key: string; value: string }[]) =>
    studioRequest<{ missingEnvVars: string[] }>(session.host, '/api/deploy/env', {
      method: 'POST',
      token: session.token,
      body: { ...target, env, values },
    });

  let missing: string[];
  try {
    ({ missingEnvVars: missing } = await request([]));
  } catch (error) {
    // A Studio without the route: the deploy's own warning still applies.
    if (error instanceof StudioApiError && error.status === 404) {
      return;
    }
    throw error;
  }
  if (missing.length === 0) {
    return;
  }

  const one = missing.length === 1;
  console.log(
    `${missing.join(', ')} ${one ? 'is' : 'are'} declared in ${APP_SPEC_FILE_NAME} but ` +
      `${one ? 'has' : 'have'} no value in this environment. ` +
      `Enter ${one ? 'it' : 'them'} now, or leave empty to skip:`
  );
  const values: { key: string; value: string }[] = [];
  for (const key of missing) {
    const secret = env[key]?.type === 'secret';
    const value = await ask(`  ${key}${secret ? ' (secret)' : ''}: `, { secret });
    if (value.length > 0) {
      values.push({ key, value });
    }
  }
  if (values.length > 0) {
    await request(values);
    console.log(`Saved ${values.length} variable${values.length === 1 ? '' : 's'}.`);
  }
}
