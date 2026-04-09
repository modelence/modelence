import { MigrationScript } from '../migration';
import { Module } from './module';

let autoLoadedModules: Module[] = [];
let autoLoadedMigrations: MigrationScript[] = [];

/**
 * Registers modules discovered by the file-based auto-loading system.
 * Called by the generated entry wrapper before the user's app.ts runs.
 * @internal
 */
export function setAutoLoadedModules(modules: Module[]) {
  autoLoadedModules = modules;
}

/**
 * Returns a copy of modules registered via the auto-loading system.
 * Called by startApp to merge with explicitly passed modules.
 * @internal
 */
export function getAutoLoadedModules(): Module[] {
  return [...autoLoadedModules];
}

/**
 * Registers migrations discovered by the file-based auto-loading system.
 * Called by the generated entry wrapper before the user's app.ts runs.
 * @internal
 */
export function setAutoLoadedMigrations(migrations: MigrationScript[]) {
  autoLoadedMigrations = migrations;
}

/**
 * Returns a copy of migrations registered via the auto-loading system.
 * Called by startApp to merge with explicitly passed migrations.
 * @internal
 */
export function getAutoLoadedMigrations(): MigrationScript[] {
  return [...autoLoadedMigrations];
}
