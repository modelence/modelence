import { callCloudApi } from '../app/backendApi';

type UploadFileParams = {
  fileName: string;
  contentType: string;
  data: ArrayBuffer | Uint8Array;
};

type FileRecord = {
  fileId: string;
  fileName: string;
  contentType: string;
  size: number;
  url: string;
  createdAt: string;
};

type ListFilesParams = {
  limit?: number;
  offset?: number;
};

type ListFilesResult = {
  files: FileRecord[];
  total: number;
};

export async function uploadFile({
  fileName,
  contentType,
  data,
}: UploadFileParams): Promise<FileRecord> {
  const formData = new FormData();
  const blob = new Blob([data as ArrayBuffer], { type: contentType });
  formData.append('file', blob, fileName);

  return await callCloudApi('/api/files/upload', 'POST', formData);
}

export async function getFile(fileId: string): Promise<FileRecord> {
  return await callCloudApi(`/api/files/${encodeURIComponent(fileId)}`, 'GET');
}

export async function listFiles({
  limit = 50,
  offset = 0,
}: ListFilesParams = {}): Promise<ListFilesResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  return await callCloudApi(`/api/files?${params}`, 'GET');
}

export async function deleteFile(fileId: string): Promise<void> {
  await callCloudApi(`/api/files/${encodeURIComponent(fileId)}`, 'DELETE');
}
