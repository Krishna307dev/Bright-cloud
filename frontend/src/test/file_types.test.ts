import { describe, it, expect } from 'vitest';
import type { FileRecord } from '../models';
import {
  canonicalizePath,
  getParentPath,
  isDescendantOf,
  generateRuleId,
} from '../utils/path';
import { formatBytes } from '../utils/format';

describe('Real File Types & Structural Integrity', () => {
  // 1. PDF File
  it('correctly models and identifies a PDF document file', () => {
    const pdfFile: FileRecord = {
      fileId: 'file-pdf-101',
      sourceId: 'usb-primary-drive',
      relativePath: 'Documents/Contracts/',
      originalName: 'Service_Agreement_2026.pdf',
      storedName: 'Service_Agreement_2026.pdf',
      mimeType: 'application/pdf',
      size: 2451000,
      lastModified: 1727632800000,
      version: 0,
      sha256: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      status: 'UPLOADED',
      uploadedAt: new Date(1727632800000),
      jobId: 'job-001',
      isPublicToFriends: true,
      allowedFriends: [],
      customPermissions: false,
    };

    expect(pdfFile.mimeType).toBe('application/pdf');
    expect(pdfFile.originalName.endsWith('.pdf')).toBe(true);
    expect(formatBytes(pdfFile.size)).toBe('2.3 MB');
    expect(canonicalizePath(pdfFile.relativePath)).toBe('Documents/Contracts/');
  });

  // 2. Image File
  it('correctly models an image file with custom permissions override', () => {
    const imageFile: FileRecord = {
      fileId: 'file-img-102',
      sourceId: 'usb-primary-drive',
      relativePath: 'Photos/2026/',
      originalName: 'HighRes_Photo.jpg',
      storedName: 'HighRes_Photo.jpg',
      mimeType: 'image/jpeg',
      size: 5824000,
      lastModified: 1727632900000,
      version: 0,
      sha256: 'b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdefa1',
      status: 'UPLOADED',
      uploadedAt: new Date(1727632900000),
      jobId: 'job-001',
      isPublicToFriends: false,
      allowedFriends: ['friend-uid-alice'],
      customPermissions: true,
    };

    expect(imageFile.mimeType).toBe('image/jpeg');
    expect(imageFile.customPermissions).toBe(true);
    expect(imageFile.allowedFriends).toContain('friend-uid-alice');
    expect(formatBytes(imageFile.size)).toBe('5.6 MB');
  });

  // 3. Video File
  it('correctly models a large video file with formatted size', () => {
    const videoFile: FileRecord = {
      fileId: 'file-vid-103',
      sourceId: 'usb-primary-drive',
      relativePath: 'Recordings/',
      originalName: 'Keynote_Presentation.mp4',
      storedName: 'Keynote_Presentation.mp4',
      mimeType: 'video/mp4',
      size: 154820000,
      lastModified: 1727633000000,
      version: 0,
      sha256: 'c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdefa1b2',
      status: 'UPLOADED',
      uploadedAt: new Date(1727633000000),
      jobId: 'job-001',
      isPublicToFriends: true,
      allowedFriends: [],
      customPermissions: false,
    };

    expect(videoFile.mimeType).toBe('video/mp4');
    expect(videoFile.size).toBeGreaterThan(100000000);
    expect(formatBytes(videoFile.size)).toBe('147.6 MB');
  });

  // 4. Nested-Folder File
  it('correctly traverses deep folder hierarchies and generates breadcrumbs', () => {
    const deepFilePath = 'Projects/2026/BrightCloud/Research/Paper/';
    const nestedFile: FileRecord = {
      fileId: 'file-nest-104',
      sourceId: 'usb-primary-drive',
      relativePath: deepFilePath,
      originalName: 'Final_Draft(1).docx',
      storedName: 'Final_Draft(1).docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 850000,
      lastModified: 1727633100000,
      version: 1,
      sha256: 'd4e5f678901234567890abcdef1234567890abcdef1234567890abcdefa1b2c3',
      status: 'UPLOADED',
      uploadedAt: new Date(1727633100000),
      jobId: 'job-002',
      isPublicToFriends: true,
      allowedFriends: [],
      customPermissions: false,
    };

    expect(isDescendantOf(nestedFile.relativePath, 'Projects/')).toBe(true);
    expect(isDescendantOf(nestedFile.relativePath, 'Projects/2026/')).toBe(true);
    expect(isDescendantOf(nestedFile.relativePath, 'Projects/2026/BrightCloud/')).toBe(true);
    expect(isDescendantOf(nestedFile.relativePath, 'Projects/Other/')).toBe(false);

    expect(getParentPath(nestedFile.relativePath)).toBe('Projects/2026/BrightCloud/Research/');
    expect(nestedFile.version).toBe(1);
  });

  // 5. Duplicate Filename in Different Folders
  it('isolates duplicate filenames in different folders without naming collision', () => {
    const fileFolderA: FileRecord = {
      fileId: 'file-dup-105a',
      sourceId: 'usb-source-alpha',
      relativePath: 'DeptA/Engineering/',
      originalName: 'README.md',
      storedName: 'README.md',
      size: 1200,
      lastModified: 1727633200000,
      version: 0,
      sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      status: 'UPLOADED',
      uploadedAt: new Date(1727633200000),
      jobId: 'job-003',
      isPublicToFriends: true,
      allowedFriends: [],
      customPermissions: false,
    };

    const fileFolderB: FileRecord = {
      fileId: 'file-dup-105b',
      sourceId: 'usb-source-alpha',
      relativePath: 'DeptB/Marketing/',
      originalName: 'README.md',
      storedName: 'README.md',
      size: 3400,
      lastModified: 1727633300000,
      version: 0,
      sha256: '2222222222222222222222222222222222222222222222222222222222222222',
      status: 'UPLOADED',
      uploadedAt: new Date(1727633300000),
      jobId: 'job-003',
      isPublicToFriends: false,
      allowedFriends: [],
      customPermissions: false,
    };

    // Both files have originalName 'README.md' and storedName 'README.md' (version 0)
    expect(fileFolderA.storedName).toBe(fileFolderB.storedName);
    expect(fileFolderA.version).toBe(0);
    expect(fileFolderB.version).toBe(0);

    // But they reside in distinct directory scopes
    expect(fileFolderA.relativePath).not.toBe(fileFolderB.relativePath);
    expect(isDescendantOf(fileFolderA.relativePath, 'DeptA/')).toBe(true);
    expect(isDescendantOf(fileFolderB.relativePath, 'DeptA/')).toBe(false);

    // Rule IDs generated for their respective folders are completely isolated
    const ruleIdA = generateRuleId(fileFolderA.sourceId, fileFolderA.relativePath);
    const ruleIdB = generateRuleId(fileFolderB.sourceId, fileFolderB.relativePath);
    expect(ruleIdA).not.toBe(ruleIdB);
  });
});
