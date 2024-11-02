// import { spawn } from 'child_process';
// import { fileURLToPath } from 'url';
// import { dirname, join } from 'path';
import { logInfo, logError } from './logs';
import process from 'process';

const buffer = {
  stdout: [{ log: '', timestamp: null }],
  stderr: [{ log: '', timestamp: null }]
}

export function startLoggerProcess({ elasticCloudId, elasticApiKey }: { elasticCloudId: string, elasticApiKey: string }) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  process.stdout.write = function(chunk: any, ...args: any[]) {
    addToBuffer(chunk, buffer.stdout);
    return originalStdoutWrite.apply(process.stdout, [chunk, ...args]);
  };

  process.stderr.write = function(chunk: any, ...args: any[]) {
    addToBuffer(chunk, buffer.stderr);
    return originalStderrWrite.apply(process.stderr, [chunk, ...args]);
  };

  loopSendLogs();

  // const currentFilePath = fileURLToPath(import.meta.url);
  // const projectRoot = dirname(dirname(currentFilePath));
  // const loggerPath = join(projectRoot, 'bin', 'modelence-logger', 'index.js');
  // const logger = spawn(process.execPath, [loggerPath], {
  //   env: {
  //     NODE_ENV: process.env.NODE_ENV,
  //     ELASTIC_CLOUD_ID: elasticCloudId,
  //     ELASTIC_API_KEY: elasticApiKey
  //   },
  //   stdio: ['pipe', 'inherit', 'inherit'],
  //   detached: true
  // });

  // const originalStdoutWrite = process.stdout.write;
  // const originalStderrWrite = process.stderr.write;

  // process.stdout.write = function(chunk: any, ...args: any[]) {
  //   logger.stdin.write(chunk);
  //   return originalStdoutWrite.apply(process.stdout, [chunk, ...args]);
  // };

  // process.stderr.write = function(chunk: any, ...args: any[]) {
  //   logger.stdin.write(chunk);
  //   return originalStderrWrite.apply(process.stderr, [chunk, ...args]);
  // };

  // process.on('exit', () => {
  //   process.stdout.write = originalStdoutWrite;
  //   process.stderr.write = originalStderrWrite;
  // });

  // logger.unref();
}

function addToBuffer(chunk: string, buffer: { log: string, timestamp: Date | null }[]) {
  if (chunk.length === 0) {
    return;
  }

  const timestamp = new Date();

  for (let i = 0; i < chunk.length; i++) {
    const current = buffer[buffer.length - 1];
    if (!current.timestamp) {
      current.timestamp = timestamp;
    }

    if (chunk[i] === '\n') {
      buffer.push({ log: '', timestamp: null });
    } else {
      current.log += chunk[i];
    }
  }
}


async function sendLogs() {
  const stdoutLogs = buffer.stdout.slice(0, -1);
  buffer.stdout = [buffer.stdout[buffer.stdout.length - 1]];

  const stderrLogs = buffer.stderr.slice(0, -1);
  buffer.stderr = [buffer.stderr[buffer.stderr.length - 1]];

  stdoutLogs.forEach(({ log, timestamp }: { log: string, timestamp: Date | null }) => {
    logInfo(log, { timestamp, source: 'console' });
  });
  stderrLogs.forEach(({ log, timestamp }: { log: string, timestamp: Date | null }) => {
    logError(log, { timestamp, source: 'console' });
  });
}

function loopSendLogs() {
  setTimeout(() => {
    sendLogs();
    loopSendLogs();
  }, 1000);
}