import { APP_SPEC_FILE_NAME } from './appSpec';

/*
  Variables modelence.config.json declares that have no value in the target
  environment, as Studio reports them. Named next to the config page because
  an app started without them usually dies with its own message ("DATABASE_URL
  must be set...") that says nothing about where values are set.
*/
export function describeMissingEnvVars(
  keys: string[] | undefined,
  configUrl: string | undefined,
  { deployAgain = false }: { deployAgain?: boolean } = {}
): string | null {
  if (!keys || keys.length === 0) {
    return null;
  }
  const one = keys.length === 1;
  const where = configUrl ? ` Set ${one ? 'it' : 'them'} at ${configUrl}` : '';
  return (
    `${keys.join(', ')} ${one ? 'is' : 'are'} declared in ${APP_SPEC_FILE_NAME} but ` +
    `${one ? 'has' : 'have'} no value in this environment.` +
    (where ? where + (deployAgain ? ', then deploy again.' : '') : '')
  );
}
