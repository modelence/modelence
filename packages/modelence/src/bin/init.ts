import { promises as fs } from 'fs';
import {
  AGENT_SETUP_PROMPT,
  APP_SPEC_FILE_NAME,
  SETUP_DOCS_URL,
  getAppSpecFilePath,
  writeAppSpecFile,
  type AppSpec,
} from './appSpec';

/*
  `modelence init`: write a modelence.config.json template for the user's coding
  agent to fill in from the hosted setup guide. Nothing about the project is
  inspected — the file is the contract, and the agent reads the code.
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

  const schemaHost = (options.host ?? DEFAULT_SCHEMA_HOST).replace(/\/$/, '');
  const template: AppSpec = {
    $schema: `${schemaHost}/schema/${APP_SPEC_FILE_NAME}`,
    resources: {
      app: {
        type: 'node',
        build: { node: '22', install: 'npm ci', command: null },
        start: null,
        static: [],
      },
    },
    env: {},
  };
  await writeAppSpecFile(template, cwd);

  console.log(`Wrote a ${APP_SPEC_FILE_NAME} template.`);
  console.log('Ask your coding agent to fill it in with this prompt:');
  console.log('');
  console.log(`  ${AGENT_SETUP_PROMPT}`);
  console.log('');
  console.log(`Reference: ${SETUP_DOCS_URL}`);
  console.log(`Once ${APP_SPEC_FILE_NAME} describes your app, run \`modelence deploy\`.`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
