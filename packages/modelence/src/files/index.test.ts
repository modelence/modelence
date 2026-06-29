import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import filesModule, { deleteFile, downloadFile, getFileUrl, getUploadUrl } from './index';
import { filesCollection } from './db';
import type { Context } from '../methods/types';
import type { UserInfo } from '../auth/types';

describe('files', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const fetchMock = vi.fn<typeof fetch>();

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

  // -------------------------------------------------------------------------
  // Low-level server primitives (exported from modelence/server).
  // -------------------------------------------------------------------------

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
        fields: { key: 'public/photo.png' },
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
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('deleteFile / downloadFile / getFileUrl primitives', () => {
    test('deleteFile POSTs to /api/files/delete', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        headers: { get: () => null },
      } as unknown as Response);

      await deleteFile('private/photo.png');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/files/delete',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('downloadFile returns the download URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ downloadUrl: 'https://s3/presigned' }),
      } as unknown as Response);

      await expect(downloadFile('private/report.pdf')).resolves.toEqual({
        downloadUrl: 'https://s3/presigned',
      });
    });

    test('getFileUrl returns the view URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://cdn/photo.png' }),
      } as unknown as Response);

      await expect(getFileUrl('public/photo.png')).resolves.toEqual({
        url: 'https://cdn/photo.png',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Owner-aware, client-callable module methods.
  // -------------------------------------------------------------------------

  describe('_system.files owner-aware methods', () => {
    const queries = filesModule.queries as Record<
      string,
      (args: Record<string, unknown>, context: Context) => Promise<unknown>
    >;
    const mutations = filesModule.mutations as Record<
      string,
      (args: Record<string, unknown>, context: Context) => Promise<unknown>
    >;

    const anon: UserInfo | null = null;
    const owner = { id: 'owner-1', handle: 'owner' } as unknown as UserInfo;
    const other = { id: 'other-2', handle: 'other' } as unknown as UserInfo;

    const insertOneMock: Mock = vi.fn();
    const findOneMock: Mock = vi.fn();
    const deleteOneMock: Mock = vi.fn();

    beforeEach(() => {
      insertOneMock.mockReset();
      findOneMock.mockReset();
      deleteOneMock.mockReset();
      (filesCollection as unknown as { insertOne: Mock }).insertOne = insertOneMock;
      (filesCollection as unknown as { findOne: Mock }).findOne = findOneMock;
      (filesCollection as unknown as { deleteOne: Mock }).deleteOne = deleteOneMock;
    });

    function ctx(user: UserInfo | null): Context {
      return { session: null, user, roles: [] } as unknown as Context;
    }

    function mockCloudOk(payload: unknown) {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => payload,
        status: 200,
        headers: { get: () => null },
      } as unknown as Response);
    }

    const authError = 'Authentication is required to access this file';
    const notFound = 'File not found';

    describe('requestUpload', () => {
      test('requires authentication', async () => {
        await expect(
          mutations.requestUpload(
            { name: 'report.pdf', contentType: 'application/pdf', visibility: 'private' },
            ctx(anon)
          )
        ).rejects.toThrow(authError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(insertOneMock).not.toHaveBeenCalled();
      });

      test('uploads under an owner-scoped path and records ownership', async () => {
        // The cloud echoes back whatever filePath we asked it to provision.
        fetchMock.mockImplementation(async (_url, init) => {
          const body = JSON.parse((init as RequestInit).body as string);
          return {
            ok: true,
            json: async () => ({ url: 'https://s3/', fields: {}, filePath: body.filePath }),
          } as unknown as Response;
        });

        const result = (await mutations.requestUpload(
          { name: 'report.pdf', contentType: 'application/pdf', visibility: 'private' },
          ctx(owner)
        )) as { filePath: string };

        expect(result.filePath).toMatch(/^private\/u\/owner-1\/[0-9a-f]{24}-report\.pdf$/);
        expect(insertOneMock).toHaveBeenCalledWith(
          expect.objectContaining({
            filePath: result.filePath,
            ownerId: 'owner-1',
            visibility: 'private',
            contentType: 'application/pdf',
            createdAt: expect.any(Date),
          })
        );
      });
    });

    describe('getUrl', () => {
      test('public files resolve without auth or an ownership lookup', async () => {
        mockCloudOk({ url: 'https://cdn/public/photo.png' });

        const result = await queries.getUrl({ filePath: 'public/u/owner-1/x.png' }, ctx(anon));

        expect(result).toEqual({ url: 'https://cdn/public/photo.png' });
        expect(findOneMock).not.toHaveBeenCalled();
      });

      test('private file requires authentication', async () => {
        await expect(
          queries.getUrl({ filePath: 'private/u/owner-1/x.pdf' }, ctx(anon))
        ).rejects.toThrow(authError);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      test('private file: owner gets a URL', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });
        mockCloudOk({ url: 'https://s3/presigned' });

        const result = await queries.getUrl({ filePath: 'private/u/owner-1/x.pdf' }, ctx(owner));

        expect(result).toEqual({ url: 'https://s3/presigned' });
      });

      test('private file: a different authenticated user is denied (not found)', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });

        await expect(
          queries.getUrl({ filePath: 'private/u/owner-1/x.pdf' }, ctx(other))
        ).rejects.toThrow(notFound);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      test('private file with no ownership record is denied (not found)', async () => {
        findOneMock.mockResolvedValue(null);

        await expect(
          queries.getUrl({ filePath: 'private/u/owner-1/unknown.pdf' }, ctx(owner))
        ).rejects.toThrow(notFound);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe('download', () => {
      test('private file: a different user is denied', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });

        await expect(
          queries.download({ filePath: 'private/u/owner-1/x.pdf' }, ctx(other))
        ).rejects.toThrow(notFound);
      });

      test('private file: owner gets a download URL', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });
        mockCloudOk({ downloadUrl: 'https://s3/dl' });

        await expect(
          queries.download({ filePath: 'private/u/owner-1/x.pdf' }, ctx(owner))
        ).resolves.toEqual({ downloadUrl: 'https://s3/dl' });
      });
    });

    describe('remove', () => {
      test('requires authentication', async () => {
        await expect(
          mutations.remove({ filePath: 'public/u/owner-1/x.png' }, ctx(anon))
        ).rejects.toThrow(authError);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      test('owner can delete; record is removed', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });
        fetchMock.mockResolvedValue({
          ok: true,
          status: 204,
          headers: { get: () => null },
        } as unknown as Response);

        await mutations.remove({ filePath: 'private/u/owner-1/x.pdf' }, ctx(owner));

        expect(fetchMock).toHaveBeenCalledWith(
          'https://cloud.modelence.test/api/files/delete',
          expect.objectContaining({ method: 'POST' })
        );
        expect(deleteOneMock).toHaveBeenCalledWith({ filePath: 'private/u/owner-1/x.pdf' });
      });

      test('a different user cannot delete (not found, no cloud call)', async () => {
        findOneMock.mockResolvedValue({ filePath: 'private/u/owner-1/x.pdf', ownerId: 'owner-1' });

        await expect(
          mutations.remove({ filePath: 'private/u/owner-1/x.pdf' }, ctx(other))
        ).rejects.toThrow(notFound);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(deleteOneMock).not.toHaveBeenCalled();
      });

      test('deleting a public file also requires ownership', async () => {
        findOneMock.mockResolvedValue({ filePath: 'public/u/owner-1/x.png', ownerId: 'owner-1' });
        fetchMock.mockResolvedValue({
          ok: true,
          status: 204,
          headers: { get: () => null },
        } as unknown as Response);

        await mutations.remove({ filePath: 'public/u/owner-1/x.png' }, ctx(owner));
        expect(deleteOneMock).toHaveBeenCalled();
      });
    });
  });
});
