import { ObjectId } from 'mongodb';
import { sanitizeResult } from './serialize.js';

// ── Harness ───────────────────────────────────────────────────────────────────

const WARMUP = 5_000;
const ITERATIONS = 100_000;

function bench(label: string, fn: () => void): void {
  for (let i = 0; i < WARMUP; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const ops = Math.round((ITERATIONS / ms) * 1000);
  console.log(
    `  ${label.padEnd(44)} ${ms.toFixed(2).padStart(8)} ms   ${ops.toLocaleString().padStart(12)} ops/s`
  );
}

function section(title: string) {
  console.log(`\n${'─'.repeat(72)}\n  ${title}\n${'─'.repeat(72)}`);
  console.log(`  ${'scenario'.padEnd(44)} ${'total ms'.padStart(8)}   ${'ops/sec'.padStart(12)}`);
  console.log(`  ${'─'.repeat(68)}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const primitiveArray = Array.from({ length: 1_000 }, (_, i) => i);

const plainObjectArray = Array.from({ length: 500 }, (_, i) => ({
  index: i,
  name: `item-${i}`,
  active: true,
  score: Math.random(),
}));

const docArray = Array.from({ length: 500 }, () => ({
  _id: new ObjectId(),
  name: 'Alice',
  score: 42,
}));

function makeDeep(depth: number): unknown {
  if (depth === 0) return { value: 'leaf', num: 123, flag: true };
  return { level: depth, child: makeDeep(depth - 1) };
}
const deepObject = makeDeep(10);

const realisticDoc = {
  _id: new ObjectId(),
  title: 'Post title',
  body: 'Some longer body text here.',
  views: 9_001,
  published: true,
  tags: ['alpha', 'beta', 'gamma'],
  author: { _id: new ObjectId(), name: 'Alice', email: 'alice@example.com' },
  metadata: { createdAt: new Date(), source: 'web', revision: 3 },
};

// ── Run ───────────────────────────────────────────────────────────────────────

console.log(
  `\nwarm-up: ${WARMUP.toLocaleString()} iters   measured: ${ITERATIONS.toLocaleString()} iters`
);

section('1. Primitive array (1 000 numbers) — no ObjectId');
bench('sanitizeResult', () => sanitizeResult(primitiveArray));
bench('JSON.stringify', () => JSON.stringify(primitiveArray));
bench('sanitizeResult + JSON.stringify', () => JSON.stringify(sanitizeResult(primitiveArray)));

section('2. Array of 500 plain objects — no ObjectId');
bench('sanitizeResult', () => sanitizeResult(plainObjectArray));
bench('JSON.stringify', () => JSON.stringify(plainObjectArray));
bench('sanitizeResult + JSON.stringify', () => JSON.stringify(sanitizeResult(plainObjectArray)));

section('3. Array of 500 docs with ObjectId _id — must convert');
bench('sanitizeResult', () => sanitizeResult(docArray));
bench('JSON.stringify (relies on toJSON)', () => JSON.stringify(docArray));
bench('sanitizeResult + JSON.stringify', () => JSON.stringify(sanitizeResult(docArray)));

section('4. Deeply nested object (depth 10) — no ObjectId');
bench('sanitizeResult', () => sanitizeResult(deepObject));
bench('JSON.stringify', () => JSON.stringify(deepObject));
bench('sanitizeResult + JSON.stringify', () => JSON.stringify(sanitizeResult(deepObject)));

section('5. Realistic mixed document (ObjectIds + primitives)');
bench('sanitizeResult', () => sanitizeResult(realisticDoc));
bench('JSON.stringify (relies on toJSON)', () => JSON.stringify(realisticDoc));
bench('sanitizeResult + JSON.stringify', () => JSON.stringify(sanitizeResult(realisticDoc)));

console.log();
