import { describe, expect, test } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  isProjectionInclusionValue,
  isContainer,
  hasContainerAtPath,
  deletePath,
} from './projectionHelpers';

describe('data/projectionHelpers', () => {
  describe('isProjectionInclusionValue', () => {
    test('identifies inclusion values correctly', () => {
      expect(isProjectionInclusionValue(1)).toBe(true);
      expect(isProjectionInclusionValue(true)).toBe(true);
      expect(isProjectionInclusionValue({ $slice: 5 })).toBe(true);
      expect(isProjectionInclusionValue({ $elemMatch: { score: 10 } })).toBe(true);
    });

    test('identifies exclusion values correctly', () => {
      expect(isProjectionInclusionValue(0)).toBe(false);
      expect(isProjectionInclusionValue(false)).toBe(false);
      expect(isProjectionInclusionValue(null)).toBe(false);
      expect(isProjectionInclusionValue(undefined)).toBe(false);
    });
  });

  describe('isContainer', () => {
    test('accepts plain objects and arrays', () => {
      expect(isContainer({})).toBe(true);
      expect(isContainer({ a: 1 })).toBe(true);
      expect(isContainer(Object.create(null))).toBe(true);
      expect(isContainer([])).toBe(true);
      expect(isContainer([{ a: 1 }])).toBe(true);
    });

    test('rejects primitives and class instances', () => {
      expect(isContainer(null)).toBe(false);
      expect(isContainer(undefined)).toBe(false);
      expect(isContainer('string')).toBe(false);
      expect(isContainer(123)).toBe(false);
      expect(isContainer(new Date())).toBe(false);
      expect(isContainer(new RegExp('test'))).toBe(false);
      expect(isContainer(new ObjectId())).toBe(false);
      expect(isContainer(new Map())).toBe(false);
      expect(isContainer(new Set())).toBe(false);
    });
  });

  describe('hasContainerAtPath', () => {
    test('checks for container presence at dot-path', () => {
      const doc = {
        user: {
          profile: { bio: 'hello' },
          items: [{ id: 1 }],
          primitiveTags: ['ts', 'js'],
        },
      };

      expect(hasContainerAtPath(doc, ['user', 'profile'])).toBe(true);
      expect(hasContainerAtPath(doc, ['user', 'items'])).toBe(true);
      expect(hasContainerAtPath(doc, ['user', 'primitiveTags'])).toBe(false);
      expect(hasContainerAtPath(doc, ['user', 'nonexistent'])).toBe(false);
    });
  });

  describe('deletePath', () => {
    test('deletes nested dot-path property', () => {
      const doc = {
        user: {
          profile: {
            bio: 'hello',
            secret: '123',
          },
        },
      };

      deletePath(doc, ['user', 'profile', 'secret']);
      expect(doc.user.profile).toEqual({ bio: 'hello' });
    });

    test('preserves parent object structure when inner property is deleted', () => {
      const doc = {
        user: {
          secret: '123',
        },
      };

      deletePath(doc, ['user', 'secret']);
      expect(doc.user).toEqual({});
    });
  });
});
