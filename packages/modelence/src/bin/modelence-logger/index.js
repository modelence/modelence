// import winston from 'winston';
// import { ElasticsearchTransport } from 'winston-elasticsearch';

const buffer = {
  stdout: [{ log: '', timestamp: null }],
  stderr: [{ log: '', timestamp: null }],
};

process.stdin.setEncoding('utf8');

console.log('Starting logger...', process.env);

process.stdin.on('data', (chunk) => {
  const isStderr = chunk.fd === 2;

  if (isStderr) {
    // process.stderr.write(chunk);
    // addToBuffer(chunk, buffer.stderr);
  } else {
    // process.stdout.write(chunk);
    // addToBuffer(chunk, buffer.stdout);
  }

  // TODO: move out into a 1-2s timer loop
  // Send immediately for now
  // sendLogs();
});

// Handle Ctrl+C and kill commands
process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down logger...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down logger...');
  process.exit(0);
});

// Handle broken pipe (happens if parent process crashes)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    console.error('Broken pipe detected, shutting down logger...');
    process.exit(0);
  }
});

// Handle end of input stream
process.stdin.on('end', () => {
  process.exit(0);
});

// function addToBuffer(chunk, buffer) {
//   if (chunk.length === 0) {
//     return;
//   }

//   const timestamp = new Date();

//   for (let i = 0; i < chunk.length; i++) {
//     const current = buffer[buffer.length - 1];
//     if (!current.timestamp) {
//       current.timestamp = timestamp;
//     }

//     if (chunk[i] === '\n') {
//       buffer.push({ log: '', timestamp: null });
//     } else {
//       current.log += chunk[i];
//     }
//   }
// }

// async function sendLogs() {
//   const stdoutLogs = buffer.stdout.slice(0, -1);
//   buffer.stdout = [buffer.stdout[buffer.stdout.length - 1]];

//   const stderrLogs = buffer.stderr.slice(0, -1);
//   buffer.stderr = [buffer.stderr[buffer.stderr.length - 1]];

//   stdoutLogs.forEach(({ log, timestamp }: { log: string, timestamp: string }) => {
//     logInfo(log, { timestamp, source: 'console' });
//   });
//   stderrLogs.forEach(({ log, timestamp }: { log: string, timestamp: string }) => {
//     logError(log, { timestamp, source: 'console' });
//   });
// }
