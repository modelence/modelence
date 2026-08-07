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
//
// Usage: node mcp-auth.js <project-dir>   (the plugin passes ${CLAUDE_PROJECT_DIR})

const fs = require('fs');
const path = require('path');

function readToken(projectDir) {
  if (!projectDir) return null;
  let content;
  try {
    content = fs.readFileSync(path.join(projectDir, '.modelence.env'), 'utf8');
  } catch {
    return null;
  }

  // KEY=value or KEY="value", last assignment wins — mirrors dotenv closely
  // enough for this one machine-written key (modelence setup writes KEY="value").
  let token = null;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*MODELENCE_SERVICE_TOKEN\s*=\s*("?)(.*)\1\s*$/);
    if (match && match[2]) token = match[2];
  }
  return token;
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

const override = process.env.MODELENCE_MCP_URL;
if (override && !isLocalUrl(override)) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const token = readToken(process.argv[2]);
// Tokens are hex; anything with characters invalid in an HTTP header value is
// treated as absent rather than sent.
const valid = token && /^[\x21-\x7e]+$/.test(token);
process.stdout.write(JSON.stringify(valid ? { 'X-Modelence-Service-Token': token } : {}));
