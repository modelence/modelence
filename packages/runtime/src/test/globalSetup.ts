import { build } from 'tsup';

// The bin tests run what ships: build dist/ once before they start.
export default async function setup(): Promise<void> {
  await build({ config: true, silent: true });
}
