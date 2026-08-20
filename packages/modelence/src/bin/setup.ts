import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseEnv } from 'dotenv';
import { createInterface } from 'readline';
import { authenticateCli } from './auth';

const MODELENCE_ENV_FILE = '.modelence.env';
const MODELENCE_DIR = '.modelence';
const PROJECT_FILE = 'project.json';

interface SetupResponse {
  environmentId: string;
  serviceEndpoint: string;
  serviceToken: string;
  containerId: string;
  // Absent on older Modelence Cloud versions.
  appId?: string;
}

/*
  Two ways to authenticate against /api/setup, matching the two ways setup is
  run: a setup token pasted from the dashboard, or a CLI token from the
  browser device flow. Either way the credential itself carries the
  environment choice — the server derives the target from it, so nothing
  else needs to be sent.
*/
type SetupAuth = { setupToken: string } | { cliToken: string };

async function fetchServiceConfig(host: string, auth: SetupAuth): Promise<SetupResponse> {
  const headers: Record<string, string> =
    'setupToken' in auth
      ? { 'X-Modelence-Setup-Token': auth.setupToken }
      : { Authorization: `Bearer ${auth.cliToken}` };

  const response = await fetch(`${host}/api/setup`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function confirmOverwrite(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `Warning: ${MODELENCE_ENV_FILE} already exists. Do you want to overwrite it? (y/N) `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      }
    );
  });
}

function escapeEnvValue(value: string | number): string {
  // Convert to string and escape quotes
  return String(value).replace(/"/g, '\\"');
}

/*
  Records which app this project belongs to in .modelence/project.json. Unlike
  .modelence.env this file is meant to be committed (the .modelence/ root holds
  CLI-managed project state; only designated subdirs like cache/ are
  temporary), so the whole team gets it. It's a hint in the git-remote sense —
  connect flows use it to preselect the app, never to block a different
  choice — which is why failing to write it doesn't fail the setup.

  Only the app goes here: which ENVIRONMENT a working copy connects to is
  per-developer state, already recorded by .modelence.env, and committing it
  would make teammates connected to different environments fight over the
  value.
*/
/*
  The app this project was last connected to, if a previous setup (by anyone
  on the team — the file is committed) recorded it. Used only to preselect
  the app on the approval page; anything unreadable means "no hint".
*/
async function readProjectAppId(): Promise<string | undefined> {
  try {
    const content = await fs.readFile(join(process.cwd(), MODELENCE_DIR, PROJECT_FILE), 'utf8');
    const { appId } = JSON.parse(content);
    return typeof appId === 'string' && appId ? appId : undefined;
  } catch {
    return undefined;
  }
}

async function recordProjectAppId(appId: string): Promise<void> {
  const dirPath = join(process.cwd(), MODELENCE_DIR);
  const projectPath = join(dirPath, PROJECT_FILE);

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  } catch {
    // Missing or malformed — start fresh.
  }

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(projectPath, JSON.stringify({ ...existing, appId }, null, 2) + '\n');
}

const CLAUDE_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_PLUGIN_ID = 'modelence@modelence';

/*
  Makes the Modelence Claude Code plugin available in connected projects that
  didn't start from the template (which ships this file). Only ever creates
  the file: an existing settings.json is the user's own — a missing or
  explicitly disabled plugin entry there gets a hint, not an edit, so a
  deliberate opt-out is never flipped back on. The file is inert for people
  who don't use Claude Code, and like the project file, failing to write it
  doesn't fail the setup.
*/
async function ensureClaudePluginEnabled(): Promise<void> {
  const settingsPath = join(process.cwd(), CLAUDE_SETTINGS_FILE);

  let content: string;
  try {
    content = await fs.readFile(settingsPath, 'utf8');
  } catch {
    // Missing — create it with just the plugin enabled.
    try {
      await fs.mkdir(join(process.cwd(), CLAUDE_DIR), { recursive: true });
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ enabledPlugins: { [CLAUDE_PLUGIN_ID]: true } }, null, 2) + '\n'
      );
      console.log(`Enabled the Modelence Claude Code plugin in ${CLAUDE_SETTINGS_FILE}`);
    } catch (error) {
      console.warn(`Failed to create ${CLAUDE_SETTINGS_FILE}:`, error);
    }
    return;
  }

  try {
    const settings = JSON.parse(content);
    const enabled = settings?.enabledPlugins?.[CLAUDE_PLUGIN_ID];
    if (enabled !== true) {
      console.warn(
        `Note: the Modelence plugin is ${enabled === false ? 'disabled' : 'not enabled'} in ` +
          `${CLAUDE_SETTINGS_FILE}. To get Modelence tools and docs in Claude Code, add ` +
          `"${CLAUDE_PLUGIN_ID}": true under "enabledPlugins".`
      );
    }
  } catch {
    console.warn(`Could not parse ${CLAUDE_SETTINGS_FILE} to check the Modelence plugin status.`);
  }
}

async function backupEnvFile(envPath: string): Promise<void> {
  try {
    const backupPath = envPath.replace('.env', '.backup.env');
    await fs.copyFile(envPath, backupPath);
    console.log(`Backup created at ${backupPath}`);
  } catch (error) {
    console.warn('Failed to create backup file:', error);
  }
}

export async function setup(options: { token?: string; host: string }) {
  try {
    const envPath = join(process.cwd(), MODELENCE_ENV_FILE);
    let existingEnv = {};
    let fileExisted = false;

    try {
      // Check if .modelence.env exists
      const envContent = await fs.readFile(envPath, 'utf8');
      existingEnv = parseEnv(envContent);
      fileExisted = true;

      // Create backup before overwriting
      await backupEnvFile(envPath);

      // Ask for confirmation before overwriting
      const shouldContinue = await confirmOverwrite();
      if (!shouldContinue) {
        console.log('Setup canceled');
        process.exit(0);
      }
    } catch {
      // File doesn't exist, we'll create it
    }

    let auth: SetupAuth;
    if (options.token) {
      auth = { setupToken: options.token };
    } else {
      // No token given: authorize in the browser, where the approval page
      // also asks which environment to connect to.
      const { token: cliToken } = await authenticateCli(options.host, {
        pickEnvironment: true,
        appId: await readProjectAppId(),
      });
      auth = { cliToken };
    }

    // Fetch service configuration
    console.log('Fetching service configuration...');
    const config = await fetchServiceConfig(options.host, auth);

    // Update environment variables
    const newEnv = {
      ...existingEnv,
      MODELENCE_TELEMETRY_ENABLED: 'false', // TODO: Remove after all usages are gone
      MODELENCE_ENVIRONMENT_ID: config.environmentId,
      MODELENCE_SERVICE_ENDPOINT: options.host, // TODO: Replace with config.serviceEndpoint in the future
      MODELENCE_SERVICE_TOKEN: config.serviceToken,
      MODELENCE_CONTAINER_ID: config.containerId,
    };

    // Convert to .env format with escaped values
    const envContent = Object.entries(newEnv)
      .map(([key, value]) => `${key}="${escapeEnvValue(value)}"`)
      .join('\n');

    // Write the file
    await fs.writeFile(envPath, envContent.trim() + '\n');
    console.log(`Successfully configured ${MODELENCE_ENV_FILE} file`);

    if (config.appId) {
      try {
        await recordProjectAppId(config.appId);
        console.log(`Recorded the app ID in ${MODELENCE_DIR}/${PROJECT_FILE}`);
      } catch (error) {
        console.warn(`Failed to record the app ID in ${MODELENCE_DIR}/${PROJECT_FILE}:`, error);
      }
    }

    await ensureClaudePluginEnabled();

    if (fileExisted) {
      // Anything that read the old file holds stale credentials: the dev
      // server loads it at boot, and MCP connections send its token per
      // connection.
      console.log(
        'The project now points to a different environment. Restart your dev server, and if you use ' +
          'an AI coding agent, reconnect its Modelence MCP server (in Claude Code: /mcp) or start a new session.'
      );
    }
  } catch (error: unknown) {
    console.error(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
