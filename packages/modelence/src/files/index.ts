import { Module } from '../app/module';
import { callCloudApi } from '../app/backendApi';
export type { FileVisibility, GetUploadUrlResult } from './types';
import type { FileVisibility, GetUploadUrlResult } from './types';

type DownloadFileResult = {
  downloadUrl: string;
};

type GetFileUrlResult = {
  url: string;
};

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

// The file operations above are server-only. They proxy to Modelence Cloud
// using the app's service token and accept any `filePath`, so they must NOT be
// callable directly from an untrusted client — exposing them would let any
// caller mint signed URLs for, download, or delete arbitrary paths. Apps reach
// these through their own queries/mutations, which enforce authorization. The
// module therefore registers no client-callable methods.
export default new Module('_system.files', {});
