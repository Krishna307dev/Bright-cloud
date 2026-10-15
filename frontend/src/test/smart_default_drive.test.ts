import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileService, saveLastOpenedDrive } from '../services/firestore/fileService';
import type { SourceEntity, FileRecord } from '../models';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocs: vi.fn().mockResolvedValue({
      empty: true,
      docs: [],
    }),
  };
});

// In-memory localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Smart Default Drive Resolution (FileService.resolveSmartDefaultDrive)', () => {
  const vaultId = 'test-vault-1';

  const mockSources: SourceEntity[] = [
    {
      sourceId: 'usb-empty',
      displayName: 'Empty USB Drive',
      usbVendorId: 100,
      usbProductId: 200,
      firstSeen: new Date('2026-01-01'),
      lastSeen: new Date('2026-01-01'),
      totalFilesBackedUp: 0,
      rulesGeneration: 1,
      status: 'ACTIVE',
    },
    {
      sourceId: 'usb-active-1',
      displayName: 'Photos Drive',
      usbVendorId: 101,
      usbProductId: 201,
      firstSeen: new Date('2026-02-01'),
      lastSeen: new Date('2026-03-01'),
      totalFilesBackedUp: 25,
      rulesGeneration: 1,
      status: 'ACTIVE',
    },
    {
      sourceId: 'WEB_UPLOADS',
      displayName: 'Web Uploads',
      usbVendorId: 0,
      usbProductId: 0,
      firstSeen: new Date('2026-03-01'),
      lastSeen: new Date('2026-03-10'),
      totalFilesBackedUp: 5,
      rulesGeneration: 1,
      status: 'ACTIVE',
    },
  ];

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('honors deep link drive parameter over any other default', async () => {
    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'admin-uid',
      true,
      'WEB_UPLOADS'
    );

    expect(result.defaultSourceId).toBe('WEB_UPLOADS');
  });

  it('selects the remembered drive from localStorage if it exists and is non-empty (Rule 1.a)', async () => {
    saveLastOpenedDrive(vaultId, 'admin-uid', 'usb-active-1');

    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([
      {
        fileId: 'file-recent',
        sourceId: 'WEB_UPLOADS',
        uploadedAt: new Date('2026-04-01'),
      } as unknown as FileRecord,
    ]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'admin-uid',
      true
    );

    // Even though WEB_UPLOADS has newer files, the user remembered drive wins
    expect(result.defaultSourceId).toBe('usb-active-1');
  });

  it('ignores remembered drive if it is empty and falls back to most recent activity (Rule 1.a fallback to 1.b)', async () => {
    saveLastOpenedDrive(vaultId, 'admin-uid', 'usb-empty');

    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([
      {
        fileId: 'file-1',
        sourceId: 'WEB_UPLOADS',
        uploadedAt: new Date('2026-03-15'),
      } as unknown as FileRecord,
      {
        fileId: 'file-2',
        sourceId: 'usb-active-1',
        uploadedAt: new Date('2026-03-05'),
      } as unknown as FileRecord,
    ]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'admin-uid',
      true
    );

    // usb-empty was ignored because it is empty; WEB_UPLOADS selected because it has the most recent file
    expect(result.defaultSourceId).toBe('WEB_UPLOADS');
  });

  it('selects the drive with the most recent file activity when no remembered drive exists (Rule 1.b)', async () => {
    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([
      {
        fileId: 'f-1',
        sourceId: 'usb-active-1',
        uploadedAt: new Date('2026-04-10'),
      } as unknown as FileRecord,
      {
        fileId: 'f-2',
        sourceId: 'WEB_UPLOADS',
        uploadedAt: new Date('2026-03-10'),
      } as unknown as FileRecord,
    ]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'admin-uid',
      true
    );

    expect(result.defaultSourceId).toBe('usb-active-1');
  });

  it('places empty drives at the end of sortedSources for the drive switcher (Rule 2)', async () => {
    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'admin-uid',
      true
    );

    // usb-empty has totalFilesBackedUp = 0, so it must be last
    const lastSource = result.sortedSources[result.sortedSources.length - 1];
    expect(lastSource.sourceId).toBe('usb-empty');
    expect(result.emptySourceIds.has('usb-empty')).toBe(true);
  });

  it('respects non-admin permissions: only files visible to the friend determine non-emptiness (Rule 3)', async () => {
    // For friend: usb-active-1 only has private files; WEB_UPLOADS has a public file
    vi.spyOn(FileService, 'fetchFriendRecentFiles').mockResolvedValue([
      {
        fileId: 'pub-1',
        sourceId: 'WEB_UPLOADS',
        isPublicToFriends: true,
        uploadedAt: new Date('2026-03-12'),
      } as unknown as FileRecord,
    ]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      mockSources,
      'friend-uid-1',
      false
    );

    // Friend cannot see usb-active-1 private files; WEB_UPLOADS is chosen
    expect(result.defaultSourceId).toBe('WEB_UPLOADS');
    expect(result.emptySourceIds.has('usb-empty')).toBe(true);
  });

  it('selects first drive when every drive is empty (Rule 1.d)', async () => {
    const allEmptySources: SourceEntity[] = [
      { ...mockSources[0], sourceId: 'empty-1', totalFilesBackedUp: 0 },
      { ...mockSources[0], sourceId: 'empty-2', totalFilesBackedUp: 0 },
    ];

    vi.spyOn(FileService, 'listAdminRecentFiles').mockResolvedValue([]);

    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      allEmptySources,
      'admin-uid',
      true
    );

    expect(result.defaultSourceId).toBe('empty-1');
    expect(result.emptySourceIds.size).toBe(2);
  });

  it('returns empty result when sources list is empty', async () => {
    const result = await FileService.resolveSmartDefaultDrive(
      vaultId,
      [],
      'admin-uid',
      true
    );

    expect(result.defaultSourceId).toBe('');
    expect(result.sortedSources).toEqual([]);
    expect(result.emptySourceIds.size).toBe(0);
  });
});
