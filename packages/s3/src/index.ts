import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import type { StorageProvider } from 'modelence/types';
import { getConfig } from 'modelence/server';

export type { StorageBody, StorageInput, StorageUrlInput, StorageDeleteInput } from 'modelence/types';

let s3Client: S3Client | null = null;

function getS3Config() {
  return {
    accessKeyId: getConfig('_system.storage.s3.accessKeyId') as string | undefined,
    secretAccessKey: getConfig('_system.storage.s3.secretAccessKey') as string | undefined,
    region: getConfig('_system.storage.s3.region') as string | undefined,
    bucket: getConfig('_system.storage.s3.bucket') as string | undefined,
    endpoint: getConfig('_system.storage.s3.endpoint') as string | undefined,
  };
}

function initializeS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const { accessKeyId, secretAccessKey, region, endpoint } = getS3Config();

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 credentials are not configured. Please set MODELENCE_STORAGE_S3_ACCESS_KEY_ID and ' +
      'MODELENCE_STORAGE_S3_SECRET_ACCESS_KEY in your environment variables or configure them ' +
      'from cloud.modelence.com'
    );
  }

  s3Client = new S3Client({
    region: region ?? 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  return s3Client;
}

function getBucket(): string {
  const { bucket } = getS3Config();
  if (!bucket) {
    throw new Error(
      'S3 bucket name is not configured. Please set MODELENCE_STORAGE_S3_BUCKET in your ' +
      'environment variables or configure it from cloud.modelence.com'
    );
  }
  return bucket;
}

function isReadable(body: unknown): body is Readable {
  return typeof body === 'object' && body !== null && typeof (body as Readable).pipe === 'function';
}

export async function put({
  key,
  body,
  contentType,
  size,
}: {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType?: string;
  size?: number;
}): Promise<void> {
  const client = initializeS3Client();
  const bucket = getBucket();

  try {
    if (isReadable(body)) {
      await new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(size !== undefined ? { ContentLength: size } : {}),
        },
      }).done();
    } else {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(size !== undefined ? { ContentLength: size } : {}),
        })
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to upload file to S3: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getUrl({
  key,
  expiresIn,
}: {
  key: string;
  expiresIn?: number;
}): Promise<string> {
  const client = initializeS3Client();
  const bucket = getBucket();

  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresIn ?? 3600 }
    );
  } catch (error) {
    throw new Error(
      `Failed to generate presigned URL for S3 object: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function del({ key }: { key: string }): Promise<void> {
  const client = initializeS3Client();
  const bucket = getBucket();

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw new Error(
      `Failed to delete file from S3: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export default {
  put,
  getUrl,
  delete: del,
} as StorageProvider;
