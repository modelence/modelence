#!/usr/bin/env node

import { setupCommand } from './commands/setup';

const args = process.argv.slice(2);

async function main() {
  try {
    await setupCommand(args);
  } catch (error) {
    console.error('Command failed:', error);
    process.exit(1);
  }
}

main();