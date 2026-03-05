import type { StorageProvider } from '../types';

export type StorageConfig = {
  provider?: StorageProvider;
};

let storageConfig: StorageConfig = Object.freeze({});

export function setStorageConfig(newStorageConfig: StorageConfig) {
  storageConfig = Object.freeze(Object.assign({}, storageConfig, newStorageConfig));
}

export function getStorageConfig() {
  return storageConfig;
}
