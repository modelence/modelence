import { Module } from '../app/module';
import { callCloudApi } from '../app/backendApi';

export type FileVisibility = 'public' | 'private';

export type GetUploadUrlResult = {
  url: string;
  fields: Record<string, string>;
  filePath: string;
};

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
  return await callCloudApi<GetUploadUrlResult>(
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

export default new Module('_system.files', {
  queries: {
    async downloadFile({ filePath }) {
      return downloadFile(filePath as string);
    },
    async getFileUrl({ filePath }) {
      return getFileUrl(filePath as string);
    },
  },
  mutations: {
    async getUploadUrl({ filePath, contentType, visibility }) {
      return getUploadUrl({
        filePath: filePath as string,
        contentType: contentType as string,
        visibility: visibility as FileVisibility,
      });
    },
    async deleteFile({ filePath }) {
      return deleteFile(filePath as string);
    },
  },
});
