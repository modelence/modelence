import path from 'path';
import { Module } from '../app/module';
import { callCloudApi } from '../app/backendApi';
import { AuthError, ValidationError } from '../error';
export type { FileVisibility, GetUploadUrlResult } from './types';
import type { FileVisibility, GetUploadUrlResult } from './types';
import type { UserInfo } from '@/auth/types';

type DownloadFileResult = {
  downloadUrl: string;
};

type GetFileUrlResult = {
  url: string;
};

const MANAGED_FILE_ROOT = 'users';

function normalizeRelativeFilePath(filePath: string): string {
  const trimmed = filePath.trim();

  if (!trimmed) {
    throw new ValidationError('File path is required');
  }

  if (trimmed.startsWith('public/') || trimmed.startsWith('private/')) {
    throw new ValidationError(
      'Upload file paths must be relative. Pass visibility separately instead of prefixing the path.'
    );
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new ValidationError('File path must be a safe relative path');
  }

  return normalized;
}

function normalizeStoredFilePath(filePath: string): string {
  const trimmed = filePath.trim();

  if (!trimmed) {
    throw new ValidationError('File path is required');
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new ValidationError('File path must be a safe stored path');
  }

  return normalized;
}

function parseStoredFilePath(filePath: string): { visibility: FileVisibility; filePath: string } {
  const normalized = normalizeStoredFilePath(filePath);

  if (normalized.startsWith('public/')) {
    return { visibility: 'public', filePath: normalized };
  }

  if (normalized.startsWith('private/')) {
    return { visibility: 'private', filePath: normalized };
  }

  throw new ValidationError("Stored file paths must start with 'public/' or 'private/'");
}

function requireAuthenticatedUserId(user: UserInfo | null): string {
  if (!user?.id) {
    throw new AuthError('Not authenticated');
  }

  return user.id;
}

function buildOwnedPrefix(visibility: FileVisibility, userId: string): string {
  return `${visibility}/${MANAGED_FILE_ROOT}/${userId}/`;
}

function scopeManagedUploadPath(
  relativeFilePath: string,
  visibility: FileVisibility,
  userId: string
): string {
  return `${visibility}/${MANAGED_FILE_ROOT}/${userId}/${relativeFilePath}`;
}

function assertOwnedStoredPath(
  storedFilePath: string,
  visibility: FileVisibility,
  userId: string,
  action: string
) {
  if (!storedFilePath.startsWith(buildOwnedPrefix(visibility, userId))) {
    throw new AuthError(`Not authorized to ${action} this file`);
  }
}

export async function getUploadUrl({
  filePath,
  contentType,
  visibility,
}: {
  filePath: string;
  contentType: string;
  visibility: FileVisibility;
}): Promise<GetUploadUrlResult> {
  return await callCloudApi<GetUploadUrlResult>('/api/files/upload', 'POST', {
    filePath,
    contentType,
    visibility,
  });
}

export async function deleteFile(filePath: string): Promise<void> {
  await callCloudApi<void>('/api/files/delete', 'POST', { filePath });
}

export async function downloadFile(filePath: string): Promise<DownloadFileResult> {
  return await callCloudApi<DownloadFileResult>('/api/files/download', 'POST', { filePath });
}

export async function getFileUrl(filePath: string): Promise<GetFileUrlResult> {
  return await callCloudApi<GetFileUrlResult>('/api/files/url', 'POST', { filePath });
}

export default new Module('_system.files', {
  queries: {
    async downloadFile({ filePath }, { user }) {
      const userId = requireAuthenticatedUserId(user);
      const parsed = parseStoredFilePath(filePath as string);

      if (parsed.visibility !== 'private') {
        throw new ValidationError('downloadFile only supports private files');
      }

      assertOwnedStoredPath(parsed.filePath, parsed.visibility, userId, 'download');
      return downloadFile(parsed.filePath);
    },
    async getFileUrl({ filePath }, { user }) {
      const parsed = parseStoredFilePath(filePath as string);

      if (parsed.visibility === 'public') {
        return getFileUrl(parsed.filePath);
      }

      const userId = requireAuthenticatedUserId(user);
      assertOwnedStoredPath(parsed.filePath, parsed.visibility, userId, 'access');
      return getFileUrl(parsed.filePath);
    },
  },
  mutations: {
    async getUploadUrl({ filePath, contentType, visibility }, { user }) {
      const userId = requireAuthenticatedUserId(user);
      const relativeFilePath = normalizeRelativeFilePath(filePath as string);
      const scopedFilePath = scopeManagedUploadPath(
        relativeFilePath,
        visibility as FileVisibility,
        userId
      );

      return getUploadUrl({
        filePath: scopedFilePath,
        contentType: contentType as string,
        visibility: visibility as FileVisibility,
      });
    },
    async deleteFile({ filePath }, { user }) {
      const userId = requireAuthenticatedUserId(user);
      const parsed = parseStoredFilePath(filePath as string);

      assertOwnedStoredPath(parsed.filePath, parsed.visibility, userId, 'delete');
      return deleteFile(parsed.filePath);
    },
  },
});
