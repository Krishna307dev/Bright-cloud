import { describe, it, expect } from 'vitest';
import { getFileCategory, isPreviewable, isTextual } from '../utils/fileType';

describe('File Type Resolver & Viewer Logic', () => {
  it('correctly categorizes files by extension', () => {
    expect(getFileCategory('report.pdf')).toBe('pdf');
    expect(getFileCategory('photo.png')).toBe('image');
    expect(getFileCategory('camera.heic')).toBe('image');
    expect(getFileCategory('clip.mp4')).toBe('video');
    expect(getFileCategory('song.mp3')).toBe('audio');
    expect(getFileCategory('readme.md')).toBe('document');
    expect(getFileCategory('notes.txt')).toBe('document');
    expect(getFileCategory('app.tsx')).toBe('code');
    expect(getFileCategory('script.py')).toBe('code');
    expect(getFileCategory('data.csv')).toBe('spreadsheet');
    expect(getFileCategory('sheet.xlsx')).toBe('spreadsheet');
    expect(getFileCategory('deck.pptx')).toBe('presentation');
    expect(getFileCategory('archive.tar.gz')).toBe('archive');
    expect(getFileCategory('binary.bin')).toBe('other');
  });

  it('respects explicit MIME type when present', () => {
    expect(getFileCategory('unknown-name', 'application/pdf')).toBe('pdf');
    expect(getFileCategory('stream', 'image/jpeg')).toBe('image');
    expect(getFileCategory('stream', 'video/mp4')).toBe('video');
    expect(getFileCategory('stream', 'audio/mpeg')).toBe('audio');
    expect(getFileCategory('raw', 'application/json')).toBe('code');
  });

  it('identifies previewable formats', () => {
    expect(isPreviewable('pdf')).toBe(true);
    expect(isPreviewable('image')).toBe(true);
    expect(isPreviewable('video')).toBe(true);
    expect(isPreviewable('audio')).toBe(true);
    expect(isPreviewable('code')).toBe(true);
    expect(isPreviewable('document')).toBe(true);
    expect(isPreviewable('archive')).toBe(false);
    expect(isPreviewable('other')).toBe(false);
  });

  it('identifies textual files suitable for code/text viewer', () => {
    expect(isTextual('code', 'script.js')).toBe(true);
    expect(isTextual('document', 'notes.txt')).toBe(true);
    expect(isTextual('document', 'README.md')).toBe(true);
    expect(isTextual('document', 'report.docx')).toBe(false);
    expect(isTextual('pdf', 'paper.pdf')).toBe(false);
  });
});
