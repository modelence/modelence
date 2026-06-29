import { Module } from '../app/module';
import { callCloudApi } from '../app/backendApi';
import type { Context } from '../methods/types';
import type { UserInfo } from '../auth/types';
import { filesCollection } from './db';
import { buildOwnedFilePath, isPrivatePath } from './ownership';
export type { FileVisibility, GetUploadUrlResult } from './types';
import type { FileVisibility, GetUploadUrlResult } from './types';

type DownloadFileResult = {
  downloadUrl: string;
};

type GetFileUrlResult = {
  url: string;
};

// ---------------------------------------------------------------------------
// Low-level server primitives.
//
// These proxy directly to Modelence Cloud using the app's service token and
// accept any `filePath`. They are exported from `modelence/server` for advanced
// use (apps that maintain their own ownership model), but are intentionally NOT
// registered as client-callable methods — see the owner-aware methods below.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Owner-aware, client-callable methods.
//
// These are the surface the `modelence/client` helpers (uploadFile, getFileUrl,
// downloadFile, deleteFile) call. They record ownership on upload and enforce
// it on every subsequent access, so a client can only ever reach files it owns
// (public reads stay open). The stored path is always namespaced by owner, so
// a client cannot pick a path that collides with another user's file.
// ---------------------------------------------------------------------------

function requireUser(user: UserInfo | null): UserInfo {
  if (!user) {
    throw new Error('Authentication is required to access this file');
  }
  return user;
}

/**
 * Enforces that `user` may act on `filePath` for a private file.
 *
 * Reads of public files are open and never reach this check. For private files
 * the caller must own the ownership row. A missing row (file not created
 * through these methods, or already deleted) is treated as not-found so we
 * never leak whether an arbitrary private path exists.
 */
async function requireOwnedPrivateFile(user: UserInfo, filePath: string) {
  const record = await filesCollection.findOne({ filePath });
  if (!record || record.ownerId !== user.id) {
    throw new Error('File not found');
  }
  return record;
}

async function requestUpload(
  {
    name,
    contentType,
    visibility,
  }: { name?: string; contentType: string; visibility: FileVisibility },
  user: UserInfo
): Promise<GetUploadUrlResult> {
  const filePath = buildOwnedFilePath({ visibility, ownerId: user.id, name });

  const upload = await getUploadUrl({ filePath, contentType, visibility });

  await filesCollection.insertOne({
    filePath: upload.filePath,
    ownerId: user.id,
    visibility,
    contentType,
    createdAt: new Date(),
  });

  return upload;
}

export default new Module('_system.files', {
  stores: [filesCollection],
  queries: {
    async getUrl({ filePath }, { user }: Context) {
      const path = filePath as string;
      if (isPrivatePath(path)) {
        await requireOwnedPrivateFile(requireUser(user), path);
      }
      return getFileUrl(path);
    },
    async download({ filePath }, { user }: Context) {
      const path = filePath as string;
      if (isPrivatePath(path)) {
        await requireOwnedPrivateFile(requireUser(user), path);
      }
      return downloadFile(path);
    },
  },
  mutations: {
    async requestUpload({ name, contentType, visibility }, { user }: Context) {
      return requestUpload(
        {
          name: name as string | undefined,
          contentType: contentType as string,
          visibility: visibility as FileVisibility,
        },
        requireUser(user)
      );
    },
    async remove({ filePath }, { user }: Context) {
      const path = filePath as string;
      const owner = requireUser(user);
      const record = await filesCollection.findOne({ filePath: path });
      if (!record || record.ownerId !== owner.id) {
        throw new Error('File not found');
      }
      await deleteFile(path);
      await filesCollection.deleteOne({ filePath: path });
    },
  },
});
