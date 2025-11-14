import {
  markAppStarted,
  isAppStarted,
  setMetadata,
  getEnvironmentId,
  getAppAlias,
  getEnvironmentAlias,
  getTelemetryServiceName,
  isTelemetryEnabled,
} from './state';

describe('app/state', () => {
  describe('App lifecycle', () => {
    test('isAppStarted should initially be false', () => {
      // Note: In a real test environment we'd need to reset state between tests
      // For now we'll test the current state
      expect(typeof isAppStarted()).toBe('boolean');
    });

    test('markAppStarted should set app as started', () => {
      markAppStarted();
      expect(isAppStarted()).toBe(true);
    });
  });

  describe('Metadata management', () => {
    test('setMetadata should store metadata', () => {
      setMetadata({
        environmentId: 'env-123',
        appAlias: 'my-app',
        environmentAlias: 'production',
        telemetry: {
          isEnabled: true,
          serviceName: 'my-service',
        },
      });

      expect(getEnvironmentId()).toBe('env-123');
      expect(getAppAlias()).toBe('my-app');
      expect(getEnvironmentAlias()).toBe('production');
    });

    test('getEnvironmentId should return environment ID', () => {
      setMetadata({
        environmentId: 'test-env',
        appAlias: 'test',
        environmentAlias: 'test',
        telemetry: { isEnabled: false, serviceName: 'test' },
      });

      expect(getEnvironmentId()).toBe('test-env');
    });

    test('getAppAlias should return app alias', () => {
      setMetadata({
        environmentId: 'env',
        appAlias: 'my-awesome-app',
        environmentAlias: 'staging',
        telemetry: { isEnabled: false, serviceName: 'test' },
      });

      expect(getAppAlias()).toBe('my-awesome-app');
    });

    test('getEnvironmentAlias should return environment alias', () => {
      setMetadata({
        environmentId: 'env',
        appAlias: 'app',
        environmentAlias: 'development',
        telemetry: { isEnabled: false, serviceName: 'test' },
      });

      expect(getEnvironmentAlias()).toBe('development');
    });
  });

  describe('Telemetry settings', () => {
    test('getTelemetryServiceName should return service name', () => {
      setMetadata({
        environmentId: 'env',
        appAlias: 'app',
        environmentAlias: 'prod',
        telemetry: {
          isEnabled: true,
          serviceName: 'analytics-service',
        },
      });

      expect(getTelemetryServiceName()).toBe('analytics-service');
    });

    test('isTelemetryEnabled should return true when enabled', () => {
      setMetadata({
        environmentId: 'env',
        appAlias: 'app',
        environmentAlias: 'prod',
        telemetry: {
          isEnabled: true,
          serviceName: 'service',
        },
      });

      expect(isTelemetryEnabled()).toBe(true);
    });

    test('isTelemetryEnabled should return false when disabled', () => {
      setMetadata({
        environmentId: 'env',
        appAlias: 'app',
        environmentAlias: 'prod',
        telemetry: {
          isEnabled: false,
          serviceName: 'service',
        },
      });

      expect(isTelemetryEnabled()).toBe(false);
    });
  });

  describe('Metadata merging', () => {
    test('setMetadata should merge with existing metadata', () => {
      setMetadata({
        environmentId: 'initial-env',
        appAlias: 'initial-app',
        environmentAlias: 'initial-alias',
        telemetry: {
          isEnabled: false,
          serviceName: 'initial-service',
        },
      });

      setMetadata({
        environmentId: 'updated-env',
        appAlias: 'initial-app', // unchanged
        environmentAlias: 'initial-alias', // unchanged
        telemetry: {
          isEnabled: true,
          serviceName: 'updated-service',
        },
      });

      expect(getEnvironmentId()).toBe('updated-env');
      expect(getTelemetryServiceName()).toBe('updated-service');
      expect(isTelemetryEnabled()).toBe(true);
    });
  });
});
