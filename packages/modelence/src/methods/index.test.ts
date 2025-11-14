import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Handler } from './types';

const transactionEnd = jest.fn();
const mockRequireServer = jest.fn();
const mockStartTransaction = jest.fn();
const mockRequireAccess = jest.fn();

jest.unstable_mockModule('../utils', () => ({
  requireServer: mockRequireServer,
}));

jest.unstable_mockModule('@/telemetry', () => ({
  startTransaction: mockStartTransaction,
}));

jest.unstable_mockModule('../auth/role', () => ({
  requireAccess: mockRequireAccess,
  getUnauthenticatedRoles: jest.fn(),
  hasAccess: jest.fn(),
  hasPermission: jest.fn(),
  getDefaultAuthenticatedRoles: jest.fn(),
  initRoles: jest.fn(),
}));

describe('methods/index', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    transactionEnd.mockClear();
    mockRequireServer.mockImplementation(() => undefined);
    mockStartTransaction.mockImplementation(() => ({
      end: transactionEnd,
      setContext: jest.fn(),
    }));
    mockRequireAccess.mockImplementation(() => undefined);
  });

  test('registers and runs a query', async () => {
    const { createQuery, runMethod } = await import('./index');
    const handler: Handler<string> = async () => 'ok';
    const handlerSpy = jest.fn(handler);

    createQuery('demo.getData', handlerSpy as never);
    const response = await runMethod('demo.getData', { id: 1 }, { roles: [] } as never);

    expect(mockRequireServer).toHaveBeenCalled();
    expect(handlerSpy).toHaveBeenCalledWith({ id: 1 }, expect.any(Object));
    expect(mockStartTransaction).toHaveBeenCalledWith(
      'method',
      'method:demo.getData',
      expect.objectContaining({ type: 'query' })
    );
    expect(response).toBe('ok');
  });

  test('prevents duplicate method registrations', async () => {
    const { createMutation } = await import('./index');
    const handler: Handler<void> = async () => undefined;
    const handlerSpy = jest.fn(handler);
    createMutation('demo.update', handlerSpy as never);

    expect(() => createMutation('demo.update', handlerSpy as never)).toThrow(
      "Method with name 'demo.update' is already defined."
    );
  });

  test('validateMethodName rejects reserved prefix', async () => {
    const { createQuery } = await import('./index');
    const handler: Handler = async () => undefined;
    expect(() => createQuery('_system.test', handler as never)).toThrow(
      "Method name cannot start with a reserved prefix: '_system.' (_system.test)"
    );
  });

  test('system methods require reserved prefix', async () => {
    const { _createSystemMutation } = await import('./index');
    const dummyHandler: Handler = async () => undefined;
    expect(() => _createSystemMutation('demo.test', dummyHandler as never)).toThrow(
      "System method name must start with a prefix: '_system.' (demo.test)"
    );
  });

  test('runMethod propagates errors and marks transaction', async () => {
    const { createQuery, runMethod } = await import('./index');
    const handler: Handler = async () => {
      throw new Error('fail');
    };
    const handlerSpy = jest.fn(handler);
    createQuery('demo.fail', handlerSpy as never);

    await expect(runMethod('demo.fail', {}, { roles: [] } as never)).rejects.toThrow('fail');
    expect(transactionEnd).toHaveBeenCalledWith('error');
  });
});
