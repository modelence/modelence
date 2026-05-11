import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Writable } from 'node:stream';
import React from 'react';
import type { Context } from '../methods/types';
import type { SessionInitPayload } from '../client/session';

// Mock the in-process method bridge. `_system.session.init` would normally
// require the full methods runtime; here we return a fixed payload so the
// stream renderer can run in isolation.
const mockCallInProcessMethod = jest.fn<() => Promise<SessionInitPayload>>();
jest.unstable_mockModule('./callInProcess', () => ({
  callInProcessMethod: mockCallInProcessMethod,
}));

// The render module pulls in AppProvider + ModelenceQueryProvider, which
// transitively need the Modelence app server. Replace them with thin
// passthrough components so we only exercise the streaming pipeline.
jest.unstable_mockModule('../client/AppProvider', () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.unstable_mockModule('../client/queryProvider', () => ({
  ModelenceQueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Likewise, side-effect-only installers — no-op.
jest.unstable_mockModule('../client/session', () => ({
  _parseSessionUser: (u: unknown) => u,
  _setSsrSessionResolver: jest.fn(),
}));
jest.unstable_mockModule('../config/client', () => ({
  _setSsrConfigResolver: jest.fn(),
}));

const { renderSsrTreeStream } = await import('./render');

function makeCallContext(): Context {
  // The stream renderer treats Context as opaque; it's only passed to the
  // (mocked) callInProcessMethod. A bare object is sufficient.
  return {} as Context;
}

function collectInto(): { dest: Writable; buffer: () => string; ended: () => boolean } {
  const chunks: string[] = [];
  let ended = false;
  const dest = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
    final(callback) {
      ended = true;
      callback();
    },
  });
  return {
    dest,
    buffer: () => chunks.join(''),
    ended: () => ended,
  };
}

describe('renderSsrTreeStream', () => {
  beforeEach(() => {
    mockCallInProcessMethod.mockReset();
    mockCallInProcessMethod.mockResolvedValue({
      session: { id: 'sess-1' },
      user: { id: 'user-1', email: 'a@b.c' },
      configs: {},
    } as SessionInitPayload);
  });

  test('streams full HTML when caller writes prelude + epilogue around pipe()', async () => {
    const handle = await renderSsrTreeStream({
      callContext: makeCallContext(),
      loadingElement: <div>loading</div>,
      routesElement: <main data-testid="content">hello world</main>,
    });

    expect(handle.sessionState).toContain('"user"');
    expect(handle.sessionState).toContain('user-1');

    const { dest, buffer, ended } = collectInto();

    // Caller writes prelude before piping React.
    dest.write('<!doctype html><html><head></head><body><div id="root">');

    await handle.pipe(dest);

    // After pipe() resolves, the underlying destination must STILL be open —
    // this is the regression test for the original bug where react-dom's
    // `destination.end()` closed the response prematurely.
    expect(ended()).toBe(false);

    // Caller writes epilogue.
    dest.write('</div>');
    dest.write(
      `<script id="__MODELENCE_QUERY_STATE__" type="application/json">${handle.getQueryState()}</script>`
    );
    dest.end('</body></html>');

    await new Promise<void>((resolve) => dest.on('finish', () => resolve()));

    const html = buffer();
    expect(html).toMatch(/^<!doctype html><html><head><\/head><body><div id="root">/);
    expect(html).toContain('hello world');
    expect(html).toContain('__MODELENCE_QUERY_STATE__');
    expect(html).toMatch(/<\/body><\/html>$/);
    expect(ended()).toBe(true);
  });

  test('getQueryState() throws if called before pipe() resolves', async () => {
    const handle = await renderSsrTreeStream({
      callContext: makeCallContext(),
      loadingElement: null,
      routesElement: <div>tree</div>,
    });

    expect(() => handle.getQueryState()).toThrow(/before stream finished/);
  });

  test('getQueryState() returns serialized dehydrated state after pipe() resolves', async () => {
    const handle = await renderSsrTreeStream({
      callContext: makeCallContext(),
      loadingElement: null,
      routesElement: <div>tree</div>,
    });

    const { dest } = collectInto();
    await handle.pipe(dest);

    // No queries ran, so the dehydrated state is an empty cache. Critically
    // the call must succeed (not throw) and return parseable JSON.
    const state = handle.getQueryState();
    expect(() => JSON.parse(state)).not.toThrow();
    const parsed = JSON.parse(state) as { queries?: unknown[]; mutations?: unknown[] };
    expect(Array.isArray(parsed.queries)).toBe(true);
  });

  test('invokes onShellReady callback exactly once before pipe() begins writing', async () => {
    const onShellReady = jest.fn<() => void>();

    const handle = await renderSsrTreeStream({
      callContext: makeCallContext(),
      loadingElement: null,
      routesElement: <p>shell</p>,
      onShellReady,
    });

    // Shell is ready by the time the handle resolves.
    expect(onShellReady).toHaveBeenCalledTimes(1);

    const { dest } = collectInto();
    await handle.pipe(dest);
    expect(onShellReady).toHaveBeenCalledTimes(1);
  });
});
