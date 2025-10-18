import { Module } from '../app/module';
import { dbMigrations } from './db';

export type MigrationScript = {
  version: number;
  description: string;
  handler: () => Promise<void>;
};

export async function runMigrations(migrations: MigrationScript[]) {
  if (migrations.length === 0) {
    return;
  }

  const versions = migrations.map(({ version }) => version);

  const existingVersions = await dbMigrations.fetch({ version: { $in: versions } });
  const existingVersionSet = new Set(existingVersions.map(({ version }) => version));
  const pendingMigrations = migrations.filter(({ version }) => !existingVersionSet.has(version));

  if (pendingMigrations.length === 0) {
    return;
  }

  console.log(`Running migrations (${pendingMigrations.length})...`);
  for (const { version, description, handler } of pendingMigrations) {
    console.log(`Running migration v${version}: ${description}`);
    // TODO: adjust to handle multiple containers and race conditions
    await dbMigrations.insertOne({ version, appliedAt: new Date() });
    await handler();
    console.log(`Migration v${version} complete`);
  }
}

export default new Module('_system.migration', {
  stores: [dbMigrations],
});
