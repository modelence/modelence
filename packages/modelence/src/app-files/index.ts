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

  return await callFilesApi('/api/files/upload', 'POST', formData);
}

export async function getFile(fileId: string): Promise<FileRecord> {
  return await callFilesApi(`/api/files/${encodeURIComponent(fileId)}`, 'GET');
}

export async function listFiles({
  limit = 50,
  offset = 0,
}: ListFilesParams = {}): Promise<ListFilesResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  return await callFilesApi(`/api/files?${params}`, 'GET');
}

export async function deleteFile(fileId: string): Promise<void> {
  await callFilesApi(`/api/files/${encodeURIComponent(fileId)}`, 'DELETE');
}

async function callFilesApi(
  endpoint: string,
  method: string,
  body?: FormData | object
): Promise<any> {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;

  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  const isFormData = body instanceof FormData;

  const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${MODELENCE_SERVICE_TOKEN}`,
      ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json?.error ?? text;
    } catch {
      // use raw text
    }
    throw new Error(`Modelence Cloud files API error: HTTP ${response.status}, ${message}`);
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return;
  }

  return await response.json();
}
