#!/usr/bin/env node
// headersHelper for the Modelence cloud MCP server.
//
// Reads MODELENCE_SERVICE_TOKEN from the project's .modelence.env and emits it
// as an X-Modelence-Service-Token header, giving the session automatic,
// environment-scoped access with no sign-in. Deliberately never emits an
// Authorization header — that one belongs to OAuth (`claude mcp login`), which
// a signed-in user can add on top for the org-wide tool surface.
//
// When no token is found, emits no headers at all: the server then responds
// 401 with an OAuth challenge, and Claude Code offers the normal sign-in flow.
// Claude Code discards this process's stderr, so every outcome is instead
// appended to ~/.modelence/mcp-auth.log — otherwise a helper that bailed and a
// helper that never ran look identical from the session.
//
// Usage: node mcp-auth.js <project-dir>   (the plugin passes ${CLAUDE_PROJECT_DIR})

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_PATH = path.join(os.homedir(), '.modelence', 'mcp-auth.log');
const LOG_MAX_BYTES = 64 * 1024;

// Never throws and never records the token itself: a log problem must not cost
// the session its credentials.
function log(reason) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    let size = 0;
    try {
      size = fs.statSync(LOG_PATH).size;
    } catch {
      // No log yet.
    }
    fs.writeFileSync(LOG_PATH, `${new Date().toISOString()} ${reason}\n`, {
      flag: size > LOG_MAX_BYTES ? 'w' : 'a',
    });
  } catch {
    // Unwritable home — the headers below still matter.
  }
}

// The config-level ${CLAUDE_PROJECT_DIR} substitution and the variable reaching
// this process are separate mechanisms, so try the argument then the env var.
function resolveProjectDir(argDir) {
  const candidates = [
    ['argv', argDir],
    ['CLAUDE_PROJECT_DIR', process.env.CLAUDE_PROJECT_DIR],
  ];
  for (const [source, dir] of candidates) {
    if (dir && fs.existsSync(path.join(dir, '.modelence.env'))) {
      return { dir, source };
    }
  }
  const tried = candidates.map(([source, dir]) => `${source}=${dir || '<empty>'}`).join(' ');
  return { dir: null, tried };
}

function readToken(projectDir) {
  const file = path.join(projectDir, '.modelence.env');
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { error: `${file} unreadable (${error.code})` };
  }

  // KEY=value or KEY="value", last assignment wins — mirrors dotenv closely
  // enough for this one machine-written key (modelence setup writes KEY="value").
  let token = null;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*MODELENCE_SERVICE_TOKEN\s*=\s*("?)(.*)\1\s*$/);
    if (match && match[2]) token = match[2];
  }
  return token ? { token } : { error: `no MODELENCE_SERVICE_TOKEN in ${file}` };
}

// MODELENCE_MCP_URL redirects the plugin's MCP entry to a development server
// (see .mcp.json). The token only ever goes to the default production URL or
// to localhost: env vars can be injected by a checked-out project's
// .claude/settings.json, so a non-local override may move the connection, but
// never the credential with it.
function isLocalUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function main() {
  const override = process.env.MODELENCE_MCP_URL;
  if (override && !isLocalUrl(override)) {
    return { headers: {}, reason: `no headers: non-local MODELENCE_MCP_URL (${override})` };
  }

  const { dir, source, tried } = resolveProjectDir(process.argv[2]);
  if (!dir) {
    return { headers: {}, reason: `no headers: no .modelence.env found (${tried})` };
  }

  const { token, error } = readToken(dir);
  if (!token) {
    return { headers: {}, reason: `no headers: ${error}` };
  }

  // Tokens are hex; anything with characters invalid in an HTTP header value is
  // treated as absent rather than sent.
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return { headers: {}, reason: `no headers: token in ${dir} has invalid characters` };
  }

  return {
    headers: { 'X-Modelence-Service-Token': token },
    reason: `sent token (${token.length} chars) from ${dir} via ${source}`,
  };
}

let result;
try {
  result = main();
} catch (error) {
  result = { headers: {}, reason: `no headers: unexpected error: ${error && error.message}` };
}
log(result.reason);
process.stdout.write(JSON.stringify(result.headers));
