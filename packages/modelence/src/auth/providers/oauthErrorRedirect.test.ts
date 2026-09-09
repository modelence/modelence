import { describe, expect, test } from 'vitest';
import { buildOAuthErrorRedirect } from './oauthErrorRedirect';

const SITE_URL = 'https://app.example.com';

describe('auth/providers/oauthErrorRedirect', () => {
  describe('buildOAuthErrorRedirect', () => {
    test('resolves a path against the site URL and appends error and errorCode', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, '/login', {
        error: 'Something went wrong',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe(
        'https://app.example.com/login?error=Something+went+wrong&errorCode=oauth_failed'
      );
    });

    test('resolves against a site URL that has a base path', () => {
      const url = buildOAuthErrorRedirect('https://example.com/app/', 'login', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('https://example.com/app/login?error=nope&errorCode=oauth_failed');
    });

    test('preserves existing unrelated query params', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, '/login?_redirect=%2Fdashboard', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe(
        'https://app.example.com/login?_redirect=%2Fdashboard&error=nope&errorCode=oauth_failed'
      );
    });

    test('replaces stale error params rather than duplicating them', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, '/login?error=old&errorCode=stale', {
        error: 'new',
        errorCode: 'invalid_state',
      });

      expect(url).toBe('https://app.example.com/login?error=new&errorCode=invalid_state');
    });

    test('takes an absolute target as is, ignoring the site URL', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, 'https://other.example.com/login', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('https://other.example.com/login?error=nope&errorCode=oauth_failed');
    });

    test('preserves a hash fragment', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, '/login#form', {
        error: 'nope',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe('https://app.example.com/login?error=nope&errorCode=oauth_failed#form');
    });

    test('encodes characters that would otherwise break the URL', () => {
      const url = buildOAuthErrorRedirect(SITE_URL, '/login', {
        error: 'a&b=c <script>',
        errorCode: 'oauth_failed',
      });

      expect(url).toBe(
        'https://app.example.com/login?error=a%26b%3Dc+%3Cscript%3E&errorCode=oauth_failed'
      );
    });
  });
});
