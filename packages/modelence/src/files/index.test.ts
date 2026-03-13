import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { deleteFile, downloadFile, getFileUrl, getUploadUrl } from './index';

describe('files', () => {
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

  describe('getUploadUrl', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(
        getUploadUrl({ filePath: 'photo.png', contentType: 'image/png', visibility: 'public' })
      ).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends POST request and returns presigned url, fields, and filePath', async () => {
      const uploadResult = {
        url: 'https://s3.amazonaws.com/',
        fields: {
          'Content-Type': 'image/png',
          Policy: 'base64policy',
          'X-Amz-Signature': 'abc123',
          key: 'public/photo.png',
        },
        filePath: 'public/photo.png',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => uploadResult,
      } as unknown as Response);

      const result = await getUploadUrl({
        filePath: 'photo.png',
        contentType: 'image/png',
        visibility: 'public',
      });

      expect(result).toEqual(uploadResult);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/upload',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            filePath: 'photo.png',
            contentType: 'image/png',
            visibility: 'public',
          }),
        })
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Invalid file path' }),
      } as unknown as Response);

      await expect(
        getUploadUrl({ filePath: '../escape.png', contentType: 'image/png', visibility: 'private' })
      ).rejects.toThrow('HTTP status: 400');
    });
  });

  describe('deleteFile', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(deleteFile('public/photo.png')).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends POST request to /api/files/delete with filePath', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        headers: { get: () => null },
      } as unknown as Response);

      const result = await deleteFile('private/photo.png');

      expect(result).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/delete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ filePath: 'private/photo.png' }),
        })
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'File not found' }),
      } as unknown as Response);

      await expect(deleteFile('public/nonexistent.png')).rejects.toThrow('HTTP status: 404');
    });
  });

  describe('downloadFile', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(downloadFile('private/photo.png')).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends POST request and returns download URL', async () => {
      const downloadResult = { downloadUrl: 'https://s3.amazonaws.com/presigned-download-url' };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => downloadResult,
      } as unknown as Response);

      const result = await downloadFile('private/report.pdf');

      expect(result).toEqual(downloadResult);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/download',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ filePath: 'private/report.pdf' }),
        })
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'File not found' }),
      } as unknown as Response);

      await expect(downloadFile('private/missing.pdf')).rejects.toThrow('HTTP status: 404');
    });
  });

  describe('getFileUrl', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(getFileUrl('public/photo.png')).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('sends POST request and returns view URL', async () => {
      const urlResult = { url: 'https://cdn.modelence.test/photo.png' };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => urlResult,
      } as unknown as Response);

      const result = await getFileUrl('public/photo.png');

      expect(result).toEqual(urlResult);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/url',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ filePath: 'public/photo.png' }),
        })
      );
    });

    test('throws on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'File not found' }),
      } as unknown as Response);

      await expect(getFileUrl('public/missing.png')).rejects.toThrow('HTTP status: 404');
    });
  });
});
