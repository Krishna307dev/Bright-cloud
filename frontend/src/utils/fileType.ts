export type FileCategory =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'code'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'other';

const EXTENSION_CATEGORIES: Record<string, FileCategory> = {
  // PDF
  pdf: 'pdf',

  // Images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',

  // Videos
  mp4: 'video',
  webm: 'video',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  wmv: 'video',
  flv: 'video',
  m4v: 'video',

  // Audio
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  wma: 'audio',

  // Documents
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',

  // Code
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  html: 'code',
  css: 'code',
  json: 'code',
  xml: 'code',
  py: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  go: 'code',
  rs: 'code',
  php: 'code',
  rb: 'code',
  sh: 'code',
  yml: 'code',
  yaml: 'code',
  sql: 'code',

  // Spreadsheets
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',

  // Presentations
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  key: 'presentation',

  // Archives
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive',
};

export function getFileCategory(fileName: string, mimeType?: string): FileCategory {
  if (mimeType) {
    const lowerMime = mimeType.toLowerCase();
    if (lowerMime === 'application/pdf') return 'pdf';
    if (lowerMime.startsWith('image/')) return 'image';
    if (lowerMime.startsWith('video/')) return 'video';
    if (lowerMime.startsWith('audio/')) return 'audio';
    if (lowerMime.includes('json') || lowerMime.includes('javascript') || lowerMime.includes('xml')) return 'code';
    if (lowerMime.includes('text/plain') || lowerMime.includes('text/markdown')) return 'document';
  }

  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === fileName.length - 1) {
    return 'other';
  }

  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  return EXTENSION_CATEGORIES[ext] || 'other';
}

export function isPreviewable(category: FileCategory): boolean {
  return ['pdf', 'image', 'video', 'audio', 'code', 'document'].includes(category);
}

export function isTextual(category: FileCategory, fileName: string): boolean {
  if (category === 'code') return true;
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'log'].includes(ext);
}
