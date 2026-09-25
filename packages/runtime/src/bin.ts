#!/usr/bin/env node
import { errorMessage, log } from './log';
import { run } from './run';

run().catch((error: unknown) => {
  log('Fatal: ' + errorMessage(error));
  process.exit(1);
});
