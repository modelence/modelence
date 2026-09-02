import { describe, expect, test } from 'vitest';
import { buildOAuthErrorRedirect } from './oauthErrorRedirect';

describe('auth/providers/oauthErrorRedirect', () => {
  describe('buildOAuthErrorRedirect', () => {
    test('appends error and errorCode to a relative path', () => {
      const url = buildOAuthErrorRedirect('/login', {
        error: 'Something went wrong',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('/login?error=Something+went+wrong&errorCode=oauth_failed');
    });

    test('keeps a relative result relative', () => {
      const url = buildOAuthErrorRedirect('/login', { error: 'x', errorCode: 'y' });

      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    });

    test('preserves existing unrelated query params on a relative path', () => {
      const url = buildOAuthErrorRedirect('/login?_redirect=%2Fdashboard', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('/login?_redirect=%2Fdashboard&error=nope&errorCode=oauth_failed');
    });

    test('replaces stale error params rather than duplicating them', () => {
      const url = buildOAuthErrorRedirect('/login?error=old&errorCode=stale', {
        error: 'new',
        errorCode: 'invalid_state',
      });

      expect(url).toBe('/login?error=new&errorCode=invalid_state');
    });

    test('supports an absolute URL', () => {
      const url = buildOAuthErrorRedirect('https://app.example.com/login', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('https://app.example.com/login?error=nope&errorCode=oauth_failed');
    });

    test('preserves a hash fragment', () => {
      const url = buildOAuthErrorRedirect('/login#form', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('/login?error=nope&errorCode=oauth_failed#form');
    });

    test('encodes characters that would otherwise break the URL', () => {
      const url = buildOAuthErrorRedirect('/login', {
        error: 'a&b=c <script>',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('/login?error=a%26b%3Dc+%3Cscript%3E&errorCode=oauth_failed');
    });
  });
});
