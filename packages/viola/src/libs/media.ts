import { extname } from 'pathe';

export type MediaCategory = 'image' | 'font' | 'audio' | 'video';

export interface MediaAsset {
  path: string;
  filename: string;
  category: MediaCategory;
  mimeType: string;
}

const MEDIA_EXTENSIONS: Record<MediaCategory, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  font: ['woff', 'woff2', 'ttf', 'otf'],
  audio: ['mp3', 'ogg', 'wav', 'm4a'],
  video: ['mp4', 'webm', 'mov'],
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function categorizeAsset(path: string): MediaCategory | null {
  const ext = extname(path).slice(1).toLowerCase();
  if (!ext) return null;
  for (const [category, exts] of Object.entries(MEDIA_EXTENSIONS) as [
    MediaCategory,
    readonly string[],
  ][]) {
    if (exts.includes(ext)) return category;
  }
  return null;
}

export function getMediaAccept(category: MediaCategory): string {
  return MEDIA_EXTENSIONS[category].map((ext) => `.${ext}`).join(',');
}

export function getMimeTypeByExtension(ext: string): string | undefined {
  return MIME_BY_EXT[ext.toLowerCase()];
}
