import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseEnv } from 'dotenv';
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';
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

async function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmOverwrite(): Promise<boolean> {
  const answer = await ask(
    `Warning: ${MODELENCE_ENV_FILE} already exists. Do you want to overwrite it? (y/N) `
  );
  return answer.toLowerCase() === 'y';
}

function escapeEnvValue(value: string | number): string {
  // Convert to string and escape quotes
  return String(value).replace(/"/g, '\\"');
}

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

/*
  Records which app this project belongs to in .modelence/project.json. Unlike
  .modelence.env this file is meant to be committed (the .modelence/ root holds
  CLI-managed project state; only designated subdirs like build/, cache/ and
  tmp/ are temporary), so the whole team gets it. It's a hint in the git-remote
  sense — connect flows use it to preselect the app, never to block a different
  choice — which is why failing to write it doesn't fail the setup.

  Only the app goes here: which ENVIRONMENT a working copy connects to is
  per-developer state, already recorded by .modelence.env, and committing it
  would make teammates connected to different environments fight over the
  value.
*/
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
// Without the marketplace declared alongside enabledPlugins, Claude Code
// can't resolve the plugin unless the user already ran
// `claude plugin marketplace add` themselves.
const CLAUDE_MARKETPLACE_REPO = 'modelence/modelence';
const CLAUDE_MARKETPLACES = {
  modelence: { source: { source: 'github', repo: CLAUDE_MARKETPLACE_REPO } },
};
const CLAUDE_PLUGIN_DOCS_URL = 'https://docs.modelence.com/ai-coding-agents';
const CLAUDE_PLUGIN_INSTALL_HINT =
  'Install the Modelence plugin for Claude Code by hand:\n' +
  `  claude plugin marketplace add ${CLAUDE_MARKETPLACE_REPO}\n` +
  `  claude plugin install ${CLAUDE_PLUGIN_ID}\n` +
  `Guide: ${CLAUDE_PLUGIN_DOCS_URL}`;

/*
  Declares the Modelence Claude Code plugin in the project's settings.json,
  merging into an existing file rather than replacing it. An explicit
  `false` is a deliberate opt-out and is never flipped back on. The file is
  inert for people who don't use Claude Code, and failing to write it doesn't
  fail the setup.
*/
async function ensureClaudePluginEnabled(): Promise<void> {
  const settingsPath = join(process.cwd(), CLAUDE_SETTINGS_FILE);

  let content: string | undefined;
  try {
    content = await fs.readFile(settingsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Could not read ${CLAUDE_SETTINGS_FILE}; leaving it unchanged.`);
      return;
    }
  }

  let settings: Record<string, any> = {};
  if (content !== undefined) {
    try {
      settings = JSON.parse(content);
    } catch {
      console.warn(`Could not parse ${CLAUDE_SETTINGS_FILE}; leaving it unchanged.`);
      return;
    }
  }

  // The marketplace is only a pointer, so it's always (re)declared — a file
  // with just enabledPlugins, as `claude plugin install --scope project`
  // leaves behind, can't be resolved by teammates without it. An explicit
  // `false` in enabledPlugins is the user's opt-out and is left alone.
  settings.extraKnownMarketplaces = { ...settings.extraKnownMarketplaces, ...CLAUDE_MARKETPLACES };
  if (settings.enabledPlugins?.[CLAUDE_PLUGIN_ID] === undefined) {
    settings.enabledPlugins = { ...settings.enabledPlugins, [CLAUDE_PLUGIN_ID]: true };
  }

  try {
    await fs.mkdir(join(process.cwd(), CLAUDE_DIR), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`Declared the Modelence Claude Code plugin in ${CLAUDE_SETTINGS_FILE}`);
  } catch (error) {
    console.warn(`Failed to write ${CLAUDE_SETTINGS_FILE}:`, error);
  }
}

function runClaude(args: string[]) {
  return spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' });
}

/*
  Installs the plugin through the Claude Code CLI — the one install path that
  behaves the same for the terminal, the IDE extensions and the desktop app,
  which all read the same plugin state. Touches the user's machine-wide Claude
  config, so it asks first, and it never fails the setup: without the CLI on
  PATH it prints the commands to run by hand.
*/
async function offerClaudePluginInstall(): Promise<void> {
  const probe = runClaude(['--version']);
  if (probe.error || probe.status !== 0) {
    console.log(CLAUDE_PLUGIN_INSTALL_HINT);
    return;
  }

  const answer = (await ask('Install the Modelence plugin for Claude Code? (Y/n) ')).toLowerCase();
  if (answer && answer !== 'y' && answer !== 'yes') {
    return;
  }

  // Makes the install work before Claude Code has picked up the marketplace
  // declared in .claude/settings.json. Its result only matters if the install
  // then fails: a network or auth error here is the real cause, and the
  // install's own message wouldn't point at it.
  const marketplace = runClaude(['plugin', 'marketplace', 'add', CLAUDE_MARKETPLACE_REPO]);
  const install = runClaude(['plugin', 'install', CLAUDE_PLUGIN_ID, '--scope', 'project']);
  if (install.status === 0) {
    console.log(
      'Installed the Modelence plugin for Claude Code. Sign in once from Claude Code: ' +
        'run /mcp, choose modelence, then Authenticate.'
    );
  } else {
    const failed = marketplace.status !== 0 ? marketplace : install;
    console.warn(
      `Could not install the Modelence plugin: ${(failed.stderr || failed.stdout || '').trim()}`
    );
    console.warn(CLAUDE_PLUGIN_INSTALL_HINT);
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
      // Where this working copy runs; Studio sandboxes pre-set "sandbox".
      MODELENCE_RUNTIME: process.env.MODELENCE_RUNTIME || 'local',
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
    // Interactive runs only: with --token (CI) or without a terminal there is
    // nobody to ask, and no Claude Code to set up.
    if (!options.token && process.stdin.isTTY) {
      await offerClaudePluginInstall();
    }

    if (fileExisted) {
      // The dev server reads the file at boot, and an open agent session may
      // still hold the old environment id in its context.
      console.log(
        'The project now points to a different environment. Restart your dev server, and if you use ' +
          'an AI coding agent, start a new session.'
      );
    }

    // Only for a first-time setup: re-running it on an existing file already
    // told them to restart the dev server they're running.
    if (!fileExisted && newEnv.MODELENCE_RUNTIME === 'local') {
      console.log('\nNext step — run the app on this machine:\n');
      console.log("  npm install   (if you haven't already)");
      console.log('  npm run dev   (starts the app)\n');
    }
  } catch (error: unknown) {
    console.error(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
