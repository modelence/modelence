import * as modelence from './index';

describe('modelence index', () => {
  test('should export main API', () => {
    expect(modelence).toBeDefined();
    expect(modelence.time).toBeDefined();
    expect(modelence.AuthError).toBeDefined();
    expect(modelence.ValidationError).toBeDefined();
    expect(modelence.RateLimitError).toBeDefined();
  });
});
