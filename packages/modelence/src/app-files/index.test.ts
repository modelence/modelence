import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { deleteFile, getFile, listFiles, uploadFile } from './index';

describe('app-files', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.modelence.test';
    process.env.MODELENCE_SERVICE_TOKEN = 'token-abc';
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('uploadFile', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(
        uploadFile({
          fileName: 'photo.png',
          contentType: 'image/png',
          data: new Uint8Array([1, 2, 3]),
        })
      ).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends multipart POST request and returns FileRecord', async () => {
      const fileRecord = {
        fileId: 'file_abc123',
        fileName: 'photo.png',
        contentType: 'image/png',
        size: 3,
        url: 'https://cdn.modelence.test/photo.png',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => fileRecord,
      } as unknown as Response);

      const data = new Uint8Array([1, 2, 3]);
      const result = await uploadFile({ fileName: 'photo.png', contentType: 'image/png', data });

      expect(result).toEqual(fileRecord);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/upload',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
          }),
          body: expect.any(FormData),
        })
      );

      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const formData = requestInit.body as FormData;
      const fileEntry = formData.get('file') as File;
      expect(fileEntry).toBeInstanceOf(Blob);
      expect(fileEntry.name).toBe('photo.png');
      expect(fileEntry.type).toBe('image/png');
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 413,
        text: async () => JSON.stringify({ error: 'File too large' }),
      } as unknown as Response);

      await expect(
        uploadFile({ fileName: 'big.png', contentType: 'image/png', data: new Uint8Array() })
      ).rejects.toThrow('HTTP status: 413');
    });
  });

  describe('getFile', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(getFile('file_abc123')).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends GET request with encoded fileId and returns FileRecord', async () => {
      const fileRecord = {
        fileId: 'file_abc123',
        fileName: 'photo.png',
        contentType: 'image/png',
        size: 1024,
        url: 'https://cdn.modelence.test/photo.png',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => fileRecord,
      } as unknown as Response);

      const result = await getFile('file_abc123');

      expect(result).toEqual(fileRecord);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/file_abc123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
          }),
        })
      );
    });

    test('URL-encodes special characters in fileId', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ fileId: 'file/with spaces' }),
      } as unknown as Response);

      await getFile('file/with spaces');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/file%2Fwith%20spaces',
        expect.anything()
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'File not found' }),
      } as unknown as Response);

      await expect(getFile('nonexistent')).rejects.toThrow('HTTP status: 404');
    });
  });

  describe('listFiles', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(listFiles()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends GET request with default pagination and returns files list', async () => {
      const responseBody = {
        files: [
          {
            fileId: 'file_1',
            fileName: 'a.png',
            contentType: 'image/png',
            size: 100,
            url: 'https://cdn.modelence.test/a.png',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => responseBody,
      } as unknown as Response);

      const result = await listFiles();

      expect(result).toEqual(responseBody);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files?limit=50&offset=0',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
          }),
        })
      );
    });

    test('sends GET request with custom pagination params', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ files: [], total: 0 }),
      } as unknown as Response);

      await listFiles({ limit: 10, offset: 20 });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files?limit=10&offset=20',
        expect.anything()
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      } as unknown as Response);

      await expect(listFiles()).rejects.toThrow('HTTP status: 500');
    });
  });

  describe('deleteFile', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(deleteFile('file_abc123')).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends DELETE request with encoded fileId and returns void', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        headers: { get: () => null },
      } as unknown as Response);

      const result = await deleteFile('file_abc123');

      expect(result).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/file_abc123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
          }),
        })
      );
    });

    test('URL-encodes special characters in fileId', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        headers: { get: () => null },
      } as unknown as Response);

      await deleteFile('file/with spaces');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/file%2Fwith%20spaces',
        expect.anything()
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'File not found' }),
      } as unknown as Response);

      await expect(deleteFile('nonexistent')).rejects.toThrow('HTTP status: 404');
    });
  });
});
