import { getStorageConfig } from '@/app/storageConfig';
import type { StorageDeleteInput, StorageInput, StorageUrlInput } from '../types';

const CONFIG_ERROR_MESSAGE =
  'Storage provider is not configured, see https://docs.modelence.com/storage for more details.';

export function putFile(input: StorageInput): Promise<void> {
  const provider = getStorageConfig().provider;
  if (!provider) {
    throw new Error(CONFIG_ERROR_MESSAGE);
  }
  return provider.put(input);
}

export function getFileUrl(input: StorageUrlInput): Promise<string> {
  const provider = getStorageConfig().provider;
  if (!provider) {
    throw new Error(CONFIG_ERROR_MESSAGE);
  }
  return provider.getUrl(input);
}

export function deleteFile(input: StorageDeleteInput): Promise<void> {
  const provider = getStorageConfig().provider;
  if (!provider) {
    throw new Error(CONFIG_ERROR_MESSAGE);
  }
  return provider.delete(input);
}
