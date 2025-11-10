import { acquireLock } from '@/lock';
import { Module } from '../app/module';
import { dbMigrations } from './db';
import { logInfo } from '../telemetry';

export type MigrationScript = {
  version: number;
  description: string;
  handler: () => Promise<void>;
};

export async function runMigrations(migrations: MigrationScript[]) {
  if (migrations.length === 0) {
    return;
  }

  const hasLock = await acquireLock('migrations');

  if (!hasLock) {
    logInfo('Another instance is running migrations. Skipping migration run.', {
      source: 'migrations',
    });
    return;
  }

  const versions = migrations.map(({ version }) => version);

  const existingVersions = await dbMigrations.fetch({ version: { $in: versions } });
  const existingVersionSet = new Set(existingVersions.map(({ version }) => version));
  const pendingMigrations = migrations.filter(({ version }) => !existingVersionSet.has(version));

  if (pendingMigrations.length === 0) {
    return;
  }

  logInfo(`Running migrations (${pendingMigrations.length})...`, {
    source: 'migrations',
  });
  for (const { version, description, handler } of pendingMigrations) {
    logInfo(`Running migration v${version}: ${description}`, {
      source: 'migrations',
    });
    await dbMigrations.insertOne({ version, appliedAt: new Date() });
    await handler();
    logInfo(`Migration v${version} complete`, {
      source: 'migrations',
    });
  }
}

export function startMigrations(migrations: MigrationScript[]) {
  setTimeout(() => {
    runMigrations(migrations).catch((err) => {
      console.error('Error running migrations:', err);
    });
  }, 0);
}

export default new Module('_system.migration', {
  stores: [dbMigrations],
});
