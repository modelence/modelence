import type { Readable } from 'stream';

export type StorageBody = Buffer | Uint8Array | Readable;

export type StorageInput = {
  key: string;
  body: StorageBody;
  contentType?: string;
  /** Size in bytes. Recommended when body is a Readable stream to avoid buffering. */
  size?: number;
};

export type StorageUrlInput = {
  key: string;
  /** Duration in seconds before the URL expires. Defaults to 3600. */
  expiresIn?: number;
};

export type StorageDeleteInput = {
  key: string;
};

export interface StorageProvider {
  put(input: StorageInput): Promise<void>;
  getUrl(input: StorageUrlInput): Promise<string>;
  delete(input: StorageDeleteInput): Promise<void>;
}
