import { promises as fs } from 'fs';
import {
  APP_SPEC_FILE_NAME,
  formatAppSpec,
  getAppSpecFilePath,
  writeAppSpecFile,
  type AppSpec,
} from './appSpec';
import { detectAppSpec } from './detect';

/*
  `modelence init`: detect how the project builds and runs, and write it to
  modelence.json so the next deploy is deterministic and the result can be
  read and edited. Detection still runs on every deploy for whatever the
  file leaves out.
*/

const DEFAULT_SCHEMA_HOST = 'https://cloud.modelence.com';

export interface InitOptions {
  force?: boolean;
  host?: string;
}

export async function init(options: InitOptions) {
  const cwd = process.cwd();
  const path = getAppSpecFilePath(cwd);
  if (!options.force && (await exists(path))) {
    throw new Error(`${APP_SPEC_FILE_NAME} already exists; pass --force to overwrite it.`);
  }

  const detected = await detectAppSpec(cwd);
  const schemaHost = (options.host ?? DEFAULT_SCHEMA_HOST).replace(/\/$/, '');
  const spec: AppSpec = {
    $schema: `${schemaHost}/schema/modelence.json`,
    ...detected.spec,
  };
  await writeAppSpecFile(spec, cwd);

  console.log(
    `Wrote ${APP_SPEC_FILE_NAME}` + (detected.profile ? ` (${detected.profile} project)` : '')
  );
  for (const line of formatAppSpec(spec)) {
    console.log(line);
  }
  for (const note of detected.notes) {
    console.log(`  note: ${note}`);
  }
  console.log('Edit the file to change any of this, then run `modelence deploy`.');
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
