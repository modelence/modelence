import { promises as fs } from 'fs';
import {
  AGENT_SETUP_PROMPT,
  APP_SPEC_FILE_NAME,
  APP_SPEC_SCHEMA_URL,
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

export interface InitOptions {
  force?: boolean;
}

export async function init(options: InitOptions) {
  const cwd = process.cwd();
  const path = getAppSpecFilePath(cwd);
  if (!options.force && (await exists(path))) {
    throw new Error(`${APP_SPEC_FILE_NAME} already exists; pass --force to overwrite it.`);
  }

  const template: AppSpec = {
    $schema: APP_SPEC_SCHEMA_URL,
    resources: {
      app: {
        type: 'service',
        image: 'node-22-slim',
        build: { commands: ['npm ci'] },
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
  console.log(
    `Once ${APP_SPEC_FILE_NAME} describes your app, run \`npx modelence@latest deploy\`.`
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
