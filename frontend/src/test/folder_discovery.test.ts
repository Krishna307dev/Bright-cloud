import { describe, it, expect } from 'vitest';
import { extractSubdirectories } from '../services/firestore/fileService';
import type { FileRecord } from '../models';

function makeFile(relativePath: string, originalName: string, size = 1000): FileRecord {
  return {
    fileId: `file_${originalName}`,
    sourceId: 'src_usb_1',
    relativePath,
    originalName,
    storedName: originalName,
    sha256: 'a'.repeat(64),
    size,
    lastModified: 1700000000,
    version: 0,
    status: 'UPLOADED',
    uploadedAt: new Date(),
    jobId: 'job_1',
    isPublicToFriends: false,
    allowedFriends: [],
    customPermissions: false,
  };
}

describe('Subfolder Discovery & Extraction', () => {
  it('correctly discovers immediate subfolders and calculates file counts and sizes', () => {
    const files: FileRecord[] = [
      makeFile('', 'root_file1.txt', 500),
      makeFile('', 'root_file2.txt', 500),
      makeFile('Documents/', 'doc1.pdf', 1000),
      makeFile('Documents/', 'doc2.pdf', 2000),
      makeFile('Documents/Work/', 'project.docx', 3000),
      makeFile('DCIM/Camera/', 'photo1.jpg', 4000),
      makeFile('DCIM/Camera/', 'photo2.jpg', 5000),
    ];

    // At root ('')
    const rootSubfolders = extractSubdirectories(files, '');
    expect(rootSubfolders).toHaveLength(2);

    const dcim = rootSubfolders.find((f) => f.name === 'DCIM');
    expect(dcim).toBeDefined();
    expect(dcim?.relativePath).toBe('DCIM/');
    expect(dcim?.fileCount).toBe(2);
    expect(dcim?.totalBytes).toBe(9000);

    const docs = rootSubfolders.find((f) => f.name === 'Documents');
    expect(docs).toBeDefined();
    expect(docs?.relativePath).toBe('Documents/');
    expect(docs?.fileCount).toBe(3); // 2 direct + 1 in Work/
    expect(docs?.totalBytes).toBe(6000);

    // Inside 'Documents/'
    const docSubfolders = extractSubdirectories(files, 'Documents/');
    expect(docSubfolders).toHaveLength(1);
    expect(docSubfolders[0].name).toBe('Work');
    expect(docSubfolders[0].relativePath).toBe('Documents/Work/');
    expect(docSubfolders[0].fileCount).toBe(1);
    expect(docSubfolders[0].totalBytes).toBe(3000);

    // Inside 'Documents/Work/'
    const workSubfolders = extractSubdirectories(files, 'Documents/Work/');
    expect(workSubfolders).toHaveLength(0);
  });

  it('handles empty file list gracefully', () => {
    const subfolders = extractSubdirectories([], '');
    expect(subfolders).toEqual([]);
  });

  it('handles deep nested folder paths without duplicate folder entries', () => {
    const files: FileRecord[] = [
      makeFile('A/B/C/D/', 'deep1.txt', 100),
      makeFile('A/B/C/D/', 'deep2.txt', 200),
      makeFile('A/B/E/', 'deep3.txt', 300),
    ];

    const subfolders = extractSubdirectories(files, '');
    expect(subfolders).toHaveLength(1);
    expect(subfolders[0].name).toBe('A');
    expect(subfolders[0].relativePath).toBe('A/');
    expect(subfolders[0].fileCount).toBe(3);
    expect(subfolders[0].totalBytes).toBe(600);
  });

  it('preserves empty folders created with .keep marker with fileCount 0 even when showHidden is false', () => {
    const files: FileRecord[] = [
      makeFile('', 'root_file.txt', 500),
      makeFile('EmptyProject/', '.keep', 0),
      makeFile('PopulatedProject/', '.keep', 0),
      makeFile('PopulatedProject/', 'main.py', 1200),
    ];

    // With showHidden = false (default user setting)
    const subfolders = extractSubdirectories(files, '', false);
    expect(subfolders).toHaveLength(2);

    const emptyFolder = subfolders.find((f) => f.name === 'EmptyProject');
    expect(emptyFolder).toBeDefined();
    expect(emptyFolder?.relativePath).toBe('EmptyProject/');
    expect(emptyFolder?.fileCount).toBe(0); // .keep does not inflate count
    expect(emptyFolder?.totalBytes).toBe(0);

    const popFolder = subfolders.find((f) => f.name === 'PopulatedProject');
    expect(popFolder).toBeDefined();
    expect(popFolder?.fileCount).toBe(1); // Only counts main.py
    expect(popFolder?.totalBytes).toBe(1200);
  });
});
