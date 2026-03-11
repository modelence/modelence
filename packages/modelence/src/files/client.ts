import { callMethod } from '../client/method';
import { FileVisibility, GetUploadUrlResult } from './index';

type UploadFileParams = {
  filePath: string;
  contentType: string;
  visibility: FileVisibility;
};

type UploadFileResult = {
  filePath: string;
};

export async function uploadFile(
  file: File | Blob,
  { filePath, contentType, visibility }: UploadFileParams
): Promise<UploadFileResult> {
  const { url, filePath: resolvedFilePath } = await callMethod<GetUploadUrlResult>(
    '_system.files.getUploadUrl',
    { filePath, contentType, visibility }
  );

  const uploadResponse = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: HTTP status: ${uploadResponse.status}`);
  }

  return { filePath: resolvedFilePath };
}

export async function deleteFile(filePath: string): Promise<void> {
  await callMethod('_system.files.deleteFile', { filePath });
}

export async function downloadFile(filePath: string): Promise<{ downloadUrl: string }> {
  return callMethod('_system.files.downloadFile', { filePath });
}

export async function getFileUrl(filePath: string): Promise<{ url: string }> {
  return callMethod('_system.files.getFileUrl', { filePath });
}
