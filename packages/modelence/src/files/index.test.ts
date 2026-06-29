import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthError, ValidationError } from '../error';
import { deleteFile, downloadFile, getFileUrl, getUploadUrl } from './index';
import filesModule from './index';

describe('files', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const fetchMock = vi.fn<typeof fetch>();
  const authenticatedUser = {
    id: 'user-123',
    handle: 'demo',
    roles: [],
    hasRole: () => false,
    requireRole: () => {
      throw new Error('unused');
    },
  };

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
    vi.restoreAllMocks();
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

    test('built-in mutation requires an authenticated user', async () => {
      await expect(
        filesModule.mutations.getUploadUrl.call(
          filesModule,
          {
            filePath: 'photo.png',
            contentType: 'image/png',
            visibility: 'public',
          },
          {
            user: null,
          } as never
        )
      ).rejects.toBeInstanceOf(AuthError);
    });

    test('built-in mutation scopes uploads to the authenticated user path', async () => {
      const uploadResult = {
        url: 'https://s3.amazonaws.com/',
        fields: {
          key: 'public/users/user-123/photo.png',
        },
        filePath: 'public/users/user-123/photo.png',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => uploadResult,
      } as unknown as Response);

      const result = await filesModule.mutations.getUploadUrl.call(
        filesModule,
        {
          filePath: 'photo.png',
          contentType: 'image/png',
          visibility: 'public',
        },
        {
          user: authenticatedUser,
        } as never
      );

      expect(result).toEqual(uploadResult);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/upload',
        expect.objectContaining({
          body: JSON.stringify({
            filePath: 'public/users/user-123/photo.png',
            contentType: 'image/png',
            visibility: 'public',
          }),
        })
      );
    });

    test('built-in mutation rejects prefixed upload paths', async () => {
      await expect(
        filesModule.mutations.getUploadUrl.call(
          filesModule,
          {
            filePath: 'private/report.pdf',
            contentType: 'application/pdf',
            visibility: 'private',
          },
          {
            user: authenticatedUser,
          } as never
        )
      ).rejects.toBeInstanceOf(ValidationError);
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

    test('built-in mutation only allows deleting files owned by the authenticated user', async () => {
      await expect(
        filesModule.mutations.deleteFile.call(
          filesModule,
          { filePath: 'private/users/other-user/report.pdf' },
          {
            user: authenticatedUser,
          } as never
        )
      ).rejects.toBeInstanceOf(AuthError);
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

    test('built-in query requires auth for private downloads and enforces ownership', async () => {
      await expect(
        filesModule.queries.downloadFile.call(
          filesModule,
          { filePath: 'private/users/other-user/report.pdf' },
          {
            user: authenticatedUser,
          } as never
        )
      ).rejects.toBeInstanceOf(AuthError);
    });

    test('built-in query rejects public download requests', async () => {
      await expect(
        filesModule.queries.downloadFile.call(
          filesModule,
          { filePath: 'public/users/user-123/report.pdf' },
          {
            user: authenticatedUser,
          } as never
        )
      ).rejects.toBeInstanceOf(ValidationError);
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

    test('built-in query allows anonymous access to public file URLs', async () => {
      const urlResult = { url: 'https://cdn.modelence.test/public/users/user-123/photo.png' };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => urlResult,
      } as unknown as Response);

      const result = await filesModule.queries.getFileUrl.call(
        filesModule,
        { filePath: 'public/users/user-123/photo.png' },
        {
          user: null,
        } as never
      );

      expect(result).toEqual(urlResult);
    });

    test('built-in query requires ownership for private file URLs', async () => {
      await expect(
        filesModule.queries.getFileUrl.call(
          filesModule,
          { filePath: 'private/users/other-user/report.pdf' },
          {
            user: authenticatedUser,
          } as never
        )
      ).rejects.toBeInstanceOf(AuthError);
    });
  });
});
