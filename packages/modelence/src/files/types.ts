export type FileVisibility = 'public' | 'private';

export type GetUploadUrlResult = {
  url: string;
  fields: Record<string, string>;
  filePath: string;
};
