import { updateDisposableEmailListCron } from './disposableEmails';

describe('auth/disposableEmails', () => {
  describe('updateDisposableEmailListCron', () => {
    it('should have interval set to 1 day', () => {
      // 1 day = 86400000 ms
      expect(updateDisposableEmailListCron.interval).toBe(86400000);
    });
  });
});
