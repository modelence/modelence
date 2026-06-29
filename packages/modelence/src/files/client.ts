import { callMethod } from '../client/method';
import type { FileVisibility, GetUploadUrlResult } from './types';

type UploadFileParams = {
  /**
   * A human-readable name for the file (e.g. `report.pdf`). This is a hint:
   * the server stores the file under a path it controls, namespaced by the
   * uploading user, and returns the resolved `filePath`. Two different users
   * can never produce the same stored path.
   */
  filePath: string;
  contentType: string;
  visibility: FileVisibility;
};

type UploadFileResult = {
  /** The resolved, owner-scoped storage path. Store this and pass it to the
   * other helpers. */
  filePath: string;
};

/**
 * Uploads a file through Modelence's built-in, owner-aware storage.
 *
 * Requests a presigned upload URL scoped to the current user, then POSTs the
 * file directly to storage. The current user becomes the file's owner, and
 * only they can read (for private files), download, or delete it afterwards.
 */
export async function uploadFile(
  file: File | Blob,
  { filePath, contentType, visibility }: UploadFileParams
): Promise<UploadFileResult> {
  const {
    url,
    fields,
    filePath: resolvedFilePath,
  } = await callMethod<GetUploadUrlResult>('_system.files.requestUpload', {
    name: filePath,
    contentType,
    visibility,
  });

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  formData.append('file', file);

  const uploadResponse = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: HTTP status: ${uploadResponse.status}`);
  }

  return { filePath: resolvedFilePath };
}

/** Deletes a file the current user owns. */
export async function deleteFile(filePath: string): Promise<void> {
  await callMethod('_system.files.remove', { filePath });
}

/** Returns a presigned download URL for a private file the current user owns. */
export async function downloadFile(filePath: string): Promise<{ downloadUrl: string }> {
  return callMethod('_system.files.download', { filePath });
}

/**
 * Returns a URL for a file. Public files resolve to their permanent URL;
 * private files return a time-limited presigned URL and require the current
 * user to own the file.
 */
export async function getFileUrl(filePath: string): Promise<{ url: string }> {
  return callMethod('_system.files.getUrl', { filePath });
}
