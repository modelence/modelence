import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

let instanceId: string | undefined;

// Random once-per-machine ID persisted in the user's home dir — outside any
// repo so it can never be committed and cloned. Containers without a writable
// home fall back to hostname, which is unique per container.
function getMachineKey(): string {
  try {
    const dir = path.join(os.homedir(), '.modelence');
    const file = path.join(dir, 'machine-id');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing) {
        return existing;
      }
    } catch {
      // Missing or unreadable — generate below.
    }
    const generated = randomUUID();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, generated + '\n');
    return generated;
  } catch {
    return os.hostname();
  }
}

// Stable identity of "this working copy on this machine": the same directory
// reconnecting (e.g. a dev-server restart) presents the same ID.
export function getInstanceId(): string {
  if (!instanceId) {
    instanceId = createHash('sha256')
      .update(`${getMachineKey()}\n${process.cwd()}`)
      .digest('hex')
      .slice(0, 32);
  }
  return instanceId;
}
