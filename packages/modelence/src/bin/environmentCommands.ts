import type { Command } from 'commander';
import { buildLogs, listBuilds } from './builds';
import { envList, envPush, envRemove, envRequest, envSet } from './env';
import { logs } from './logs';
import { printNote } from './output';
import { restart, status } from './status';

// The commands that work on a deployed environment (environmentSession.ts).
export function registerEnvironmentCommands(program: Command): void {
  withTarget(program.command('status'))
    .description('Show what an environment runs and what needs attention')
    .option('--json', 'Print JSON')
    .action((options) => run('Status', () => status(options)));

  withTarget(program.command('logs'))
    .description("Show an environment's recent container output")
    .option('-s, --service <service>', 'Only this service')
    .option('-n, --lines <count>', 'How many lines (up to 1000, default 200)')
    .option('--since <time>', 'Only lines since a duration ago (10m, 2h) or an ISO time')
    .option('-f, --follow', 'Keep printing new lines')
    .option('--json', 'Print one JSON object per line')
    .action((options) => run('Logs', () => logs(options)));

  const builds = program.command('builds').description("An environment's builds");
  withTarget(builds.command('list', { isDefault: true }))
    .description('List builds, newest first')
    .option('-n, --limit <count>', 'How many builds (up to 50, default 10)')
    .option('--json', 'Print JSON')
    .action((options) => run('Builds', () => listBuilds(options)));
  withTarget(builds.command('logs'))
    .description('Show the log of one build')
    .argument('[build]', 'Build number or id (default: the latest)')
    .option('-n, --lines <count>', 'How many lines from the end (default 500)')
    .option('--json', 'Print JSON')
    .action((build: string | undefined, options) =>
      run('Build logs', () => buildLogs(build, options))
    );

  registerEnvCommands(program);

  withTarget(program.command('restart'))
    .description('Restart an environment on its deployed version, applying changed variables')
    .action((options) => run('Restart', () => restart(options)));
}

function registerEnvCommands(program: Command): void {
  const env = program
    .command('env')
    .description("An environment's variables. Values of secrets are never printed");

  withTarget(env.command('list', { isDefault: true }))
    .description('List variables; values of secrets are left out')
    .option('--json', 'Print JSON')
    .action((options) => run('Env list', () => envList(options)));
  withTarget(env.command('request'))
    .description('Get a link where a person enters values in the browser, and wait for them')
    .argument('[names...]', 'Variable names (default: every required one without a value)')
    .option('--no-wait', 'Print the link and exit')
    .action((names: string[], options) => run('Env request', () => envRequest(names, options)));
  withTarget(env.command('set'))
    .description(
      'Set a variable from a hidden prompt or --stdin, or ones that are not secret as NAME=value'
    )
    .argument('<entries...>', 'NAME, or NAME=value for values that are not secret')
    .option('--stdin', 'Read the value from stdin')
    .option('--text', 'Store as plain text')
    .option('--secret', 'Store as a secret')
    .option('--scopes <scopes>', 'Where it is available: build, runtime or build,runtime')
    .action((entries: string[], options) => run('Env set', () => envSet(entries, options)));
  withTarget(env.command('push'))
    .description('Send the values in a local file, without printing them')
    .requiredOption('-f, --file <file>', 'The file, such as .env.production')
    .option('--all', 'Also variables modelence.config.json does not declare')
    .action((options) => run('Env push', () => envPush(options)));
  withTarget(env.command('remove'))
    .description('Remove variables')
    .argument('<names...>', 'Variable names')
    .action((names: string[], options) => run('Env remove', () => envRemove(names, options)));
}

function withTarget(command: Command): Command {
  return (
    command
      .option('-e, --env <env>', 'Environment alias')
      .option('-a, --app <app>', 'Application alias (default: the app in .modelence/project.json)')
      // No -h: the group's own help would take it in `env -h <host>`.
      .option('--host <host>', 'Modelence host')
  );
}

async function run(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    printNote(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
