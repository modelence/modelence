import { describe, expect, test } from 'vitest';
import { buildOwnedFilePath, isPrivatePath, sanitizeName } from './ownership';

describe('files/ownership', () => {
  describe('isPrivatePath', () => {
    test('public/ paths are not private', () => {
      expect(isPrivatePath('public/photo.png')).toBe(false);
      expect(isPrivatePath('public/u/user-1/photo.png')).toBe(false);
    });

    test('private and prefix-less/malformed paths are treated as private', () => {
      expect(isPrivatePath('private/report.pdf')).toBe(true);
      expect(isPrivatePath('report.pdf')).toBe(true);
      expect(isPrivatePath('')).toBe(true);
      // A near-miss that must NOT be mistaken for public.
      expect(isPrivatePath('publicish/x')).toBe(true);
    });
  });

  describe('sanitizeName', () => {
    test('returns empty string for missing name', () => {
      expect(sanitizeName()).toBe('');
      expect(sanitizeName('')).toBe('');
    });

    test('keeps only the leaf segment (strips directory traversal)', () => {
      expect(sanitizeName('a/b/c/report.pdf')).toBe('report.pdf');
      expect(sanitizeName('../../etc/passwd')).toBe('passwd');
      expect(sanitizeName('..\\..\\windows')).toBe('windows');
    });

    test('replaces unsafe characters and strips leading dots', () => {
      expect(sanitizeName('my file (1).png')).toBe('my_file__1_.png');
      expect(sanitizeName('...hidden')).toBe('hidden');
    });

    test('caps length', () => {
      const long = 'a'.repeat(500);
      expect(sanitizeName(long).length).toBe(128);
    });
  });

  describe('buildOwnedFilePath', () => {
    test('namespaces the path under {visibility}/u/{ownerId}/', () => {
      const path = buildOwnedFilePath({
        visibility: 'private',
        ownerId: 'user-1',
        name: 'report.pdf',
      });
      expect(path).toMatch(/^private\/u\/user-1\/[0-9a-f]{24}-report\.pdf$/);
    });

    test('public visibility produces a public/ prefix', () => {
      const path = buildOwnedFilePath({
        visibility: 'public',
        ownerId: 'user-1',
        name: 'avatar.png',
      });
      expect(path).toMatch(/^public\/u\/user-1\/[0-9a-f]{24}-avatar\.png$/);
    });

    test('omitting the name still yields a valid owner-scoped random path', () => {
      const path = buildOwnedFilePath({ visibility: 'private', ownerId: 'user-1' });
      expect(path).toMatch(/^private\/u\/user-1\/[0-9a-f]{24}$/);
    });

    test('a client-supplied name cannot escape the owner namespace', () => {
      const path = buildOwnedFilePath({
        visibility: 'private',
        ownerId: 'user-1',
        name: '../../user-2/secret.pdf',
      });
      // Only the leaf survives, under user-1's namespace.
      expect(path.startsWith('private/u/user-1/')).toBe(true);
      expect(path).not.toContain('user-2');
      expect(path).not.toContain('..');
    });

    test('two uploads of the same name yield distinct paths', () => {
      const a = buildOwnedFilePath({ visibility: 'private', ownerId: 'u', name: 'f.pdf' });
      const b = buildOwnedFilePath({ visibility: 'private', ownerId: 'u', name: 'f.pdf' });
      expect(a).not.toBe(b);
    });
  });
});
