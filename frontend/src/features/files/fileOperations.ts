import type { FileRecord } from '../../models';
import { canonicalizePath } from '../../utils/path';

export const BRIGHTCLOUD_DRAG_MIME = 'application/x-brightcloud-files';

export interface BrightCloudDragPayload {
  type: 'brightcloud-internal-move';
  fileIds: string[];
  sourceId: string;
  sourcePath: string;
  names: string[];
}

export type FileAccessLevel = 'public' | 'shared' | 'private';

/**
 * Classifies file access policy based on friend permissions model.
 * Public: isPublicToFriends is true.
 * Shared: not public, but allowedFriends has at least one entry.
 * Private: not public and no allowedFriends.
 */
export function getFileAccessLevel(file: {
  isPublicToFriends?: boolean;
  allowedFriends?: string[];
}): FileAccessLevel {
  if (file.isPublicToFriends === true) {
    return 'public';
  }
  if (Array.isArray(file.allowedFriends) && file.allowedFriends.length > 0) {
    return 'shared';
  }
  return 'private';
}

/**
 * Filters all files belonging to a drive to return only private files,
 * excluding internal placeholder .keep files.
 */
export function filterPrivateFiles(files: FileRecord[]): FileRecord[] {
  return files.filter((f) => {
    if (f.originalName === '.keep') return false;
    return getFileAccessLevel(f) === 'private';
  });
}

/**
 * Compares two relative directory paths canonicalized to detect same-folder operations.
 */
export function isSameFolder(pathA: string, pathB: string): boolean {
  return canonicalizePath(pathA) === canonicalizePath(pathB);
}

/**
 * Creates serializable drag payload for internal pointer drag-and-drop operations.
 */
export function createDragPayload(
  files: FileRecord[],
  sourceId: string,
  currentPath: string
): BrightCloudDragPayload {
  return {
    type: 'brightcloud-internal-move',
    fileIds: files.map((f) => f.fileId),
    sourceId,
    sourcePath: canonicalizePath(currentPath),
    names: files.map((f) => f.originalName || f.storedName),
  };
}

/**
 * Identifies name collisions between incoming files to move and existing files
 * in the destination directory for the same source.
 * Case-insensitive comparison against storedName or originalName.
 */
export function checkNameCollisions(
  filesToMove: FileRecord[],
  targetExistingFiles: FileRecord[]
): { canMove: FileRecord[]; collisions: FileRecord[] } {
  const existingNames = new Set(
    targetExistingFiles
      .filter((f) => f.originalName !== '.keep')
      .map((f) => (f.storedName || f.originalName).toLowerCase())
  );

  const canMove: FileRecord[] = [];
  const collisions: FileRecord[] = [];

  for (const file of filesToMove) {
    const fileName = (file.storedName || file.originalName).toLowerCase();
    if (existingNames.has(fileName)) {
      collisions.push(file);
    } else {
      canMove.push(file);
    }
  }

  return { canMove, collisions };
}
