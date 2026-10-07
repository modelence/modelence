/*
  Whether this is a CI run: the one case where the browser is never opened,
  since waiting on an approval nobody will give would only hang until a
  timeout. Everything else, agents running without a TTY included, signs in
  and picks the deploy target in the browser.
*/
export function isCI(): boolean {
  return Boolean(process.env.CI);
}
