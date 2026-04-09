import { Module } from './module';

let autoLoadedModules: Module[] = [];

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
