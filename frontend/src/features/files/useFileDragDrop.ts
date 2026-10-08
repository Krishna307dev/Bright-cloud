import { useState, useRef, useCallback } from 'react';
import type React from 'react';
import type { FileRecord } from '../../models';
import { FileService } from '../../services/firestore/fileService';
import { useToast } from '../../components/ui/Toast';
import {
  BRIGHTCLOUD_DRAG_MIME,
  createDragPayload,
  checkNameCollisions,
  isSameFolder,
  type BrightCloudDragPayload,
} from './fileOperations';
import { canonicalizePath } from '../../utils/path';

export interface UseFileDragDropOptions {
  vaultId: string;
  sourceId: string;
  currentPath: string;
  allSourceFiles: FileRecord[];
  currentFolderFiles: FileRecord[];
  selectedFileIds: Set<string>;
  isAdmin: boolean;
  onMoveSuccess: () => Promise<void>;
}

export interface UseFileDragDropResult {
  isDragging: boolean;
  draggedFileIds: string[];
  activeDropTarget: string | null;
  isMoving: boolean;
  getDraggableProps: (file: FileRecord) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
  };
  getDropTargetProps: (targetPath: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isOver: boolean;
    isValidTarget: boolean;
  };
  executeMove: (
    fileIds: string[],
    fromSourceId: string,
    fromPath: string,
    toPath: string
  ) => Promise<void>;
}

/**
 * Creates temporary offscreen DOM chip for custom HTML5 drag preview.
 */
function createDragPreview(primaryName: string, count: number): HTMLElement {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.zIndex = '-1';
  container.style.pointerEvents = 'none';

  const chip = document.createElement('div');
  chip.style.display = 'flex';
  chip.style.alignItems = 'center';
  chip.style.gap = '8px';
  chip.style.padding = '6px 12px';
  chip.style.borderRadius = '8px';
  chip.style.backgroundColor = '#0F172A';
  chip.style.color = '#FFFFFF';
  chip.style.fontSize = '12px';
  chip.style.fontWeight = '500';
  chip.style.border = '1px solid #334155';
  chip.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.2)';
  chip.style.userSelect = 'none';

  // SVG document icon
  const iconSpan = document.createElement('span');
  iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  chip.appendChild(iconSpan);

  const textSpan = document.createElement('span');
  textSpan.style.maxWidth = '150px';
  textSpan.style.overflow = 'hidden';
  textSpan.style.textOverflow = 'ellipsis';
  textSpan.style.whiteSpace = 'nowrap';
  textSpan.textContent = primaryName;
  chip.appendChild(textSpan);

  if (count > 1) {
    const badge = document.createElement('span');
    badge.style.padding = '1px 6px';
    badge.style.borderRadius = '9999px';
    badge.style.backgroundColor = '#1DB954';
    badge.style.color = '#FFFFFF';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = '700';
    badge.textContent = `+${count - 1}`;
    chip.appendChild(badge);
  }

  container.appendChild(chip);
  document.body.appendChild(container);
  return container;
}

export function useFileDragDrop({
  vaultId,
  sourceId,
  currentPath,
  allSourceFiles,
  currentFolderFiles,
  selectedFileIds,
  isAdmin,
  onMoveSuccess,
}: UseFileDragDropOptions): UseFileDragDropResult {
  const toast = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [draggedFileIds, setDraggedFileIds] = useState<string[]>([]);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const dragPayloadRef = useRef<BrightCloudDragPayload | null>(null);

  /**
   * Shared move executor for both Drag-and-Drop and Cut+Paste flows.
   */
  const executeMove = useCallback(
    async (
      fileIds: string[],
      fromSourceId: string,
      fromPath: string,
      toPath: string
    ): Promise<void> => {
      if (!vaultId || fileIds.length === 0) return;

      const canonicalFrom = canonicalizePath(fromPath);
      const canonicalTo = canonicalizePath(toPath);

      if (isSameFolder(canonicalFrom, canonicalTo)) {
        return; // Dropping on current directory is a no-op
      }

      const filesToMove = allSourceFiles.filter((f) => fileIds.includes(f.fileId));
      if (filesToMove.length === 0) return;

      // Existing files in target directory for the same source
      const targetExistingFiles = allSourceFiles.filter(
        (f) =>
          f.sourceId === fromSourceId &&
          canonicalizePath(f.relativePath || '') === canonicalTo
      );

      const { canMove, collisions } = checkNameCollisions(filesToMove, targetExistingFiles);

      if (canMove.length === 0) {
        if (collisions.length > 0) {
          toast.warning(
            `${collisions.length} file${collisions.length === 1 ? '' : 's'} skipped: name already exists in target directory.`
          );
        }
        return;
      }

      const moveCount = canMove.length;
      toast.info(`Moving ${moveCount} file${moveCount === 1 ? '' : 's'}...`);
      setIsMoving(true);

      try {
        const idsToMove = canMove.map((f) => f.fileId);
        await FileService.moveFiles(vaultId, idsToMove, canonicalTo);

        await onMoveSuccess();

        const destLabel = canonicalTo ? `/${canonicalTo.replace(/\/$/, '')}` : 'root';
        let successMsg = `Moved ${moveCount} file${moveCount === 1 ? '' : 's'} to ${destLabel}`;
        if (collisions.length > 0) {
          successMsg += ` (${collisions.length} skipped: name already exists)`;
        }

        // Provide Undo action
        toast.success(successMsg, 7000, {
          label: 'Undo',
          onClick: async () => {
            toast.info(`Undoing move for ${moveCount} file${moveCount === 1 ? '' : 's'}...`);
            try {
              await FileService.moveFiles(vaultId, idsToMove, canonicalFrom);
              await onMoveSuccess();
              toast.success(`Move undone`);
            } catch (undoErr: any) {
              toast.error(`Undo failed: ${undoErr.message}`);
              await onMoveSuccess();
            }
          },
        });
      } catch (err: any) {
        toast.error(`Move failed: ${err.message || 'Unknown error'}`);
        await onMoveSuccess();
      } finally {
        setIsMoving(false);
      }
    },
    [vaultId, allSourceFiles, onMoveSuccess, toast]
  );

  const getDraggableProps = useCallback(
    (file: FileRecord) => {
      if (!isAdmin) {
        return {
          draggable: false,
          onDragStart: () => {},
          onDragEnd: () => {},
        };
      }

      return {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          let filesToDrag: FileRecord[];

          // Multi-select drag if dragged file is in active selection
          if (selectedFileIds.has(file.fileId)) {
            filesToDrag = currentFolderFiles.filter((f) => selectedFileIds.has(f.fileId));
          } else {
            filesToDrag = [file];
          }

          if (filesToDrag.length === 0) return;

          const payload = createDragPayload(filesToDrag, sourceId, currentPath);
          dragPayloadRef.current = payload;

          e.dataTransfer.setData(BRIGHTCLOUD_DRAG_MIME, JSON.stringify(payload));
          e.dataTransfer.effectAllowed = 'move';

          // Custom drag preview chip
          const previewEl = createDragPreview(file.originalName, filesToDrag.length);
          e.dataTransfer.setDragImage(previewEl, 20, 20);
          setTimeout(() => {
            previewEl.remove();
          }, 0);

          setIsDragging(true);
          setDraggedFileIds(payload.fileIds);
        },
        onDragEnd: () => {
          setIsDragging(false);
          setDraggedFileIds([]);
          setActiveDropTarget(null);
          dragPayloadRef.current = null;
        },
      };
    },
    [isAdmin, selectedFileIds, currentFolderFiles, sourceId, currentPath]
  );

  const getDropTargetProps = useCallback(
    (targetPath: string) => {
      const canonicalTarget = canonicalizePath(targetPath);
      const canonicalCurrent = canonicalizePath(currentPath);
      const isValidTarget = !isSameFolder(canonicalCurrent, canonicalTarget);

      return {
        onDragOver: (e: React.DragEvent) => {
          const isInternal =
            e.dataTransfer.types.includes(BRIGHTCLOUD_DRAG_MIME) || isDragging;
          if (!isInternal || !isAdmin) return;

          if (isValidTarget) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (activeDropTarget !== canonicalTarget) {
              setActiveDropTarget(canonicalTarget);
            }
          } else {
            e.dataTransfer.dropEffect = 'none';
          }
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          if (activeDropTarget === canonicalTarget) {
            setActiveDropTarget(null);
          }
        },
        onDrop: (e: React.DragEvent) => {
          const isInternal =
            e.dataTransfer.types.includes(BRIGHTCLOUD_DRAG_MIME) || isDragging;
          if (!isInternal || !isAdmin) return;

          e.preventDefault();
          e.stopPropagation();
          setActiveDropTarget(null);

          if (!isValidTarget) return;

          let payload = dragPayloadRef.current;
          if (!payload) {
            try {
              const raw = e.dataTransfer.getData(BRIGHTCLOUD_DRAG_MIME);
              if (raw) payload = JSON.parse(raw);
            } catch {}
          }

          if (!payload || payload.fileIds.length === 0) return;

          executeMove(payload.fileIds, payload.sourceId, payload.sourcePath, canonicalTarget);
        },
        isOver: activeDropTarget === canonicalTarget,
        isValidTarget,
      };
    },
    [isAdmin, isDragging, currentPath, activeDropTarget, executeMove]
  );

  return {
    isDragging,
    draggedFileIds,
    activeDropTarget,
    isMoving,
    getDraggableProps,
    getDropTargetProps,
    executeMove,
  };
}
