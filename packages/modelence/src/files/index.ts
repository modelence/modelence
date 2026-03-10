import { callCloudApi } from '../app/backendApi';

export type FileVisibility = 'public' | 'private';

type UploadFileParams = {
  filePath: string;
  contentType: string;
  visibility: FileVisibility;
};

type UploadFileResult = {
  uploadUrl: string;
  filePath: string;
};

type DownloadFileResult = {
  downloadUrl: string;
};

type GetFileUrlResult = {
  url: string;
};

export async function uploadFile({
  filePath,
  contentType,
  visibility,
}: UploadFileParams): Promise<UploadFileResult> {
  return await callCloudApi<UploadFileResult>(
    '/api/files/upload',
    'POST',
    JSON.stringify({ filePath, contentType, visibility }),
    {
      'Content-Type': 'application/json',
    }
  );
}

export async function deleteFile(filePath: string): Promise<void> {
  await callCloudApi<void>('/api/files/delete', 'POST', JSON.stringify({ filePath }), {
    'Content-Type': 'application/json',
  });
}

export async function downloadFile(filePath: string): Promise<DownloadFileResult> {
  return await callCloudApi<DownloadFileResult>(
    '/api/files/download',
    'POST',
    JSON.stringify({ filePath }),
    {
      'Content-Type': 'application/json',
    }
  );
}

export async function getFileUrl(filePath: string): Promise<GetFileUrlResult> {
  return await callCloudApi<GetFileUrlResult>(
    '/api/files/url',
    'POST',
    JSON.stringify({ filePath }),
    {
      'Content-Type': 'application/json',
    }
  );
}
