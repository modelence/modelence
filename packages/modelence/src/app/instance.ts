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

// Stable identity of "this working copy connected to this environment": the
// same directory reconnecting (e.g. a dev-server restart) presents the same
// ID, while the same directory pointed at a different environment gets a new
// one — containers.id is unique across environments in Studio.
export function getInstanceId(): string {
  if (!instanceId) {
    instanceId = createHash('sha256')
      .update(`${getMachineKey()}\n${process.cwd()}\n${process.env.MODELENCE_ENVIRONMENT_ID || ''}`)
      .digest('hex')
      .slice(0, 32);
  }
  return instanceId;
}

// A dev-time instance — a developer machine or a Studio sandbox, as marked by
// `modelence setup` — as opposed to a deployed cloud container.
export function isDevRuntime(): boolean {
  const runtime = process.env.MODELENCE_RUNTIME;
  return runtime === 'local' || runtime === 'sandbox';
}

// A developer's own machine — the only runtime that may force-take an
// environment lease held by another instance.
export function isLocalRuntime(): boolean {
  return process.env.MODELENCE_RUNTIME === 'local';
}

// For dev runtimes the container ID is the instance ID; cloud containers keep
// the Studio-issued MODELENCE_CONTAINER_ID.
export function getContainerId(): string | undefined {
  return isDevRuntime() ? getInstanceId() : process.env.MODELENCE_CONTAINER_ID;
}
