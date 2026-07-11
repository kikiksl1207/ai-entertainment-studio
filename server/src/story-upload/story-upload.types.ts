export type StoryUploadFileCategory = 'manuscript' | 'metadata' | 'visual';

export interface StoryUploadFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoryUploadFileFields {
  manuscripts?: StoryUploadFile[];
  metadata?: StoryUploadFile[];
  visuals?: StoryUploadFile[];
}

export interface StoryUploadStoredFile {
  category: StoryUploadFileCategory;
  position: number;
  extension: string;
  clientFileNameHash: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  storageProvider: string;
  storageKey: string;
  buffer: Buffer;
}
