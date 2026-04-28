import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const srcDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function findBenchFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findBenchFiles(full));
    } else if (entry.endsWith('.bench.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = findBenchFiles(srcDir);

if (files.length === 0) {
  console.log('No *.bench.ts files found under src/.');
  process.exit(0);
}

for (const file of files) {
  const rel = file.slice(srcDir.length + 1);
  console.log(`\n${'═'.repeat(72)}\n  ${rel}\n${'═'.repeat(72)}`);
  await import(pathToFileURL(file).href);
}
