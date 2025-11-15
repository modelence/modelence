import { ObjectId } from 'mongodb';
import type { Role, Session, UserInfo } from './types';

describe('auth/types', () => {
  test('should have valid Role type', () => {
    const role: Role = 'admin';
    expect(role).toBe('admin');
  });

  test('should have valid Session type', () => {
    const userId = new ObjectId();
    const session: Session = {
      userId,
      authToken: 'token123',
      expiresAt: new Date(),
    };
    expect(session.userId).toBe(userId);
    expect(session.authToken).toBe('token123');
  });

  test('should have valid UserInfo type', () => {
    const userInfo: UserInfo = {
      id: 'user123',
      handle: 'testuser',
      roles: ['admin', 'user'],
      hasRole: (_role: string) => true,
      requireRole: (_role: string) => {},
    };
    expect(userInfo.id).toBe('user123');
    expect(userInfo.handle).toBe('testuser');
  });
});
